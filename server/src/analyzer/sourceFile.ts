/*
* sourceFile.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Class that represents a single python source file.
*/

import * as assert from 'assert';
//import * as fs from 'fs';
import { CompletionList, SymbolInformation } from 'vscode-languageserver';

import { ConfigOptions, DiagnosticSettings, ExecutionEnvironment,
    getDefaultDiagnosticSettings } from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import { Diagnostic, DiagnosticCategory, DiagnosticTextPosition,
    DocumentTextRange, getEmptyRange } from '../common/diagnostic';
import { DiagnosticSink, TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { TextEditAction } from '../common/editAction';
import { getFileName, normalizeSlashes } from '../common/pathUtils';
import StringMap from '../common/stringMap';
import * as StringUtils from '../common/stringUtils';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { timingStats } from '../common/timing';
import { CompletionProvider, ModuleSymbolMap } from '../languageService/completionProvider';
import { DefinitionProvider } from '../languageService/definitionProvider';
import { DocumentSymbolProvider } from '../languageService/documentSymbolProvider';
import { HoverProvider, HoverResults } from '../languageService/hoverProvider';
import { performQuickAction } from '../languageService/quickActions';
import { ReferencesProvider, ReferencesResult } from '../languageService/referencesProvider';
import { SignatureHelpProvider, SignatureHelpResults } from '../languageService/signatureHelpProvider';
import { ModuleNode } from '../parser/parseNodes';
import { ModuleImport, ParseOptions, Parser, ParseResults } from '../parser/parser';
import { Token } from '../parser/tokenizerTypes';
import { TestWalker } from '../tests/testWalker';
import { AnalyzerFileInfo, ImportMap } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { ModuleScopeBinder } from './binder';
import { CircularDependency } from './circularDependency';
import * as CommentUtils from './commentUtils';
import { ImportResolver } from './importResolver';
import { ImportResult } from './importResult';
import { ParseTreeCleanerWalker } from './parseTreeCleaner';
import { Scope } from './scope';
import { SymbolTable } from './symbol';
import { TypeAnalyzer } from './typeAnalyzer';
import { ModuleType, TypeCategory } from './types';

const _maxImportCyclesPerFile = 4;

export const enum AnalysisPhase {
    Parse = 0,
    Bind = 1,
    TypeAnalysis = 2,

    FirstAnalysisPhase = Bind,
    LastAnalysisPhase = TypeAnalysis
}

// Represents a pending or completed parse or analysis operation.
export interface AnalysisJob {
    fileContentsVersion: number;
    nextPhaseToRun: AnalysisPhase;
    parseTreeNeedsCleaning: boolean;
    parseResults?: ParseResults;
    moduleSymbolTable?: SymbolTable;
    moduleType?: ModuleType;

    parseDiagnostics: Diagnostic[];
    bindDiagnostics: Diagnostic[];
    typeAnalysisLastPassDiagnostics: Diagnostic[];
    typeAnalysisFinalDiagnostics: Diagnostic[];

    diagnosticSettings: DiagnosticSettings;

    circularDependencies: CircularDependency[];
    hitMaxImportDepth?: number;

    typeAnalysisPassNumber: number;
    lastReanalysisReason: string;
    isTypeAnalysisPassNeeded: boolean;
    isTypeAnalysisFinalized: boolean;

    imports?: ImportResult[];
    builtinsImport?: ImportResult;
    typingModulePath?: string;
}

export class SourceFile {
    // Console interface to use for debugging.
    private _console: ConsoleInterface;

    // File path on disk.
    private readonly _filePath: string;

    // True if file is a type-hint (.pyi) file versus a python
    // (.py) file.
    private readonly _isStubFile: boolean;

    // True if the file is a typeshed stub file.
    private readonly _isTypeshedStubFile: boolean;

    // True if the file is the "typing.pyi" file, which needs
    // special-case handling.
    private readonly _isTypingStubFile: boolean;

    // True if the file one of the other built-in stub files
    // that require special-case handling: "collections.pyi",
    // "dataclasses.pyi", "abc.pyi", "asyncio/coroutines.pyi".
    private readonly _isBuiltInStubFile: boolean;

    // True if the file appears to have been deleted.
    private _isFileDeleted = false;

    // Latest analysis job that has completed at least one phase
    // of analysis.
    private _analysisJob: AnalysisJob = {
        fileContentsVersion: -1,
        nextPhaseToRun: AnalysisPhase.Bind,
        parseTreeNeedsCleaning: false,

        parseDiagnostics: [],
        bindDiagnostics: [],
        typeAnalysisLastPassDiagnostics: [],
        typeAnalysisFinalDiagnostics: [],

        diagnosticSettings: getDefaultDiagnosticSettings(),

        circularDependencies: [],

        typeAnalysisPassNumber: 1,
        lastReanalysisReason: '',
        isTypeAnalysisPassNeeded: true,
        isTypeAnalysisFinalized: false
    };

    // Number that is incremented every time the diagnostics
    // are updated.
    private _diagnosticVersion = 0;

    // Generation count of the file contents. When the contents
    // change, this is incremented.
    private _fileContentsVersion = 0;

    // Length and hash of the file the last time it was read from disk.
    private _lastFileContentLength: number | undefined = undefined;
    private _lastFileContentHash: number | undefined = undefined;

    // Client's version of the file. Null implies that contents
    // need to be read from disk.
    private _clientVersion: number | null = null;

    // In-memory contents if sent from the language client. If
    // clientVersion is null, we'll ignore this and read the
    // contents from disk.
    private _fileContents: string | undefined;

    constructor(filePath: string, isTypeshedStubFile: boolean, console?: ConsoleInterface) {
        this._console = console || new StandardConsole();
        if (this._console) {
            // This is here to prevent the compiler from complaining
            // about an unused instance variable.
        }
        this._console.log("constructing source file" + filePath);
        this._filePath = filePath;
        this._isStubFile = filePath.endsWith('.pyi');
        this._isTypeshedStubFile = isTypeshedStubFile;
        const fileName = getFileName(filePath);
        this._isTypingStubFile = this._isStubFile && (
            fileName === 'typing.pyi' || fileName === 'typing_extensions.pyi');

        this._isBuiltInStubFile = false;
        if (this._isStubFile) {
            if (this._filePath.endsWith(normalizeSlashes('/collections/__init__.pyi')) ||
                    fileName === '_importlib_modulespec.pyi' ||
                    fileName === 'dataclasses.pyi' ||
                    fileName === 'abc.pyi' ||
                    fileName === 'enum.pyi') {

                this._isBuiltInStubFile = true;
            }
        }
        this._console.log("finished constructing source file" + filePath);
    }

    getFilePath(): string {
        return this._filePath;
    }

    getDiagnosticVersion(): number {
        return this._diagnosticVersion;
    }

    isStubFile() {
        return this._isStubFile;
    }

    // Returns a list of cached diagnostics from the latest analysis job.
    // If the prevVersion is specified, the method returns undefined if
    // the diagnostics haven't changed.
    getDiagnostics(options: ConfigOptions, prevDiagnosticVersion?: number):
            Diagnostic[] | undefined {

        if (this._diagnosticVersion === prevDiagnosticVersion) {
            return undefined;
        }

        let diagList: Diagnostic[] = [];
        diagList = diagList.concat(
            this._analysisJob.parseDiagnostics,
            this._analysisJob.bindDiagnostics,
            this._analysisJob.typeAnalysisFinalDiagnostics);

        if (options.diagnosticSettings.reportImportCycles !== 'none' && this._analysisJob.circularDependencies.length > 0) {
            const category = options.diagnosticSettings.reportImportCycles === 'warning' ?
                DiagnosticCategory.Warning : DiagnosticCategory.Error;

            this._analysisJob.circularDependencies.forEach(cirDep => {
                diagList.push(new Diagnostic(category, 'Cycle detected in import chain\n' +
                    cirDep.getPaths().map(path => '  ' + path).join('\n'), getEmptyRange()));
            });
        }

        if (this._analysisJob.hitMaxImportDepth !== undefined) {
            diagList.push(new Diagnostic(DiagnosticCategory.Error,
                `Import chain depth exceeded ${ this._analysisJob.hitMaxImportDepth }`,
                getEmptyRange()));
        }

        if (this._isTypeshedStubFile) {
            if (options.diagnosticSettings.reportTypeshedErrors === 'none') {
                return undefined;
            } else if (options.diagnosticSettings.reportTypeshedErrors === 'warning') {
                // Convert all the errors to warnings.
                diagList = diagList.map(diag => {
                    if (diag.category === DiagnosticCategory.Error) {
                        return new Diagnostic(DiagnosticCategory.Warning,
                            diag.message, diag.range);
                    }
                    return diag;
                });
            }
        }

        // If the file is in the ignore list, clear the diagnostic list.
        if (options.ignore.find(ignoreFileSpec => ignoreFileSpec.regExp.test(this._filePath))) {
            diagList = [];
        }

        return diagList;
    }

    getImports(): ImportResult[] {
        return this._analysisJob.imports || [];
    }

    getBuiltinsImport(): ImportResult | undefined {
        return this._analysisJob.builtinsImport;
    }

    getModuleSymbolTable(): SymbolTable | undefined {
        return this._analysisJob.moduleSymbolTable;
    }

    getModuleType(): ModuleType | undefined {
        return this._analysisJob.moduleType;
    }

    // Indicates whether the contents of the file have changed since
    // the last analysis was performed.
    didContentsChangeOnDisk(): boolean {
        // If this is an open file any content changes will be
        // provided through the editor. We can assume contents
        // didn't change without us knowing about them.
        if (this._clientVersion !== null) {
            return false;
        }

        // Read in the latest file contents and see if the hash matches
        // that of the previous contents.
        try {
            // Read the file's contents.
            const fileContents = fs.readFileSync(this._filePath, { encoding: 'utf8' });

            if (fileContents.length !== this._lastFileContentLength) {
                return true;
            }

            if (StringUtils.hashString(fileContents) !== this._lastFileContentHash) {
                return true;
            }
        } catch (error) {
            return true;
        }

        return false;
    }

    markDirty(): void {
        this._fileContentsVersion++;
        this._analysisJob.isTypeAnalysisFinalized = false;
        this._analysisJob.nextPhaseToRun = AnalysisPhase.Bind;
    }

    markReanalysisRequired(): void {
        // Keep the parse info, but reset the analysis to the beginning.
        this._analysisJob.nextPhaseToRun = AnalysisPhase.Bind;
        this._analysisJob.parseTreeNeedsCleaning = true;
        this._analysisJob.isTypeAnalysisFinalized = false;
    }

    setClientVersion(version: number | null, contents: string): void {
        this._clientVersion = version;

        if (version === null) {
            this._fileContents = undefined;
        } else {
            if (this._fileContents !== undefined) {
                if (this._fileContents !== contents) {
                    this.markDirty();
                }
            }

            this._fileContents = contents;
        }
    }

    prepareForClose() {
        // Nothing to do currently.
    }

    isFileDeleted() {
        return this._isFileDeleted;
    }

    isParseRequired() {
        return this._analysisJob.fileContentsVersion !== this._fileContentsVersion;
    }

    isBindingRequired() {
        if (this.isParseRequired()) {
            return true;
        }

        return this._analysisJob.nextPhaseToRun <= AnalysisPhase.Bind;
    }

    isTypeAnalysisRequired() {
        if (this.isBindingRequired()) {
            return true;
        }

        // If the analysis is complete, no more analysis is required.
        if (this._analysisJob.nextPhaseToRun < AnalysisPhase.TypeAnalysis ||
                this._analysisJob.isTypeAnalysisPassNeeded) {
            return true;
        }

        return false;
    }

    isAnalysisFinalized() {
        return !this.isTypeAnalysisRequired() && this._analysisJob.isTypeAnalysisFinalized;
    }

    getParseResults(): ParseResults | undefined {
        if (!this.isParseRequired()) {
            return this._analysisJob.parseResults;
        }

        return undefined;
    }

    // Adds a new circular dependency for this file but only if
    // it hasn't already been added.
    addCircularDependency(circDependency: CircularDependency) {
        // Some topologies can result in a massive number of cycles. We'll cut it off.
        if (this._analysisJob.circularDependencies.length < _maxImportCyclesPerFile) {
            if (!this._analysisJob.circularDependencies.some(dep => dep.isEqual(circDependency))) {
                this._analysisJob.circularDependencies.push(circDependency);
            }
        }
    }

    setHitMaxImportDepth(maxImportDepth: number) {
        this._analysisJob.hitMaxImportDepth = maxImportDepth;
    }

    // Parse the file and update the state. Callers should wait for completion
    // (or at least cancel) prior to calling again. It returns true if a parse
    // was required and false if the parse information was up to date already.
    parse(configOptions: ConfigOptions, importResolver: ImportResolver): boolean {
        // If the file is already parsed, we can skip.
        if (!this.isParseRequired()) {
            return false;
        }

        const diagSink = new DiagnosticSink();
        let fileContents = this._fileContents;
        if (this._clientVersion === null) {
            try {
                timingStats.readFileTime.timeOperation(() => {
                    // Read the file's contents.
                    fileContents = fs.readFileSync(this._filePath, { encoding: 'utf8' });

                    // Remember the length and hash for comparison purposes.
                    this._lastFileContentLength = fileContents.length;
                    this._lastFileContentHash = StringUtils.hashString(fileContents);
                });
            } catch (error) {
                diagSink.addError(`Source file could not be read`, getEmptyRange());
                fileContents = '';

                if (!fs.existsSync(this._filePath)) {
                    this._isFileDeleted = true;
                }
            }
        }

        // Use the configuration options to determine the environment in which
        // this source file will be executed.
        const execEnvironment = configOptions.findExecEnvironment(this._filePath);

        const parseOptions = new ParseOptions();
        if (this._filePath.endsWith('pyi')) {
            parseOptions.isStubFile = true;
        }
        parseOptions.pythonVersion = execEnvironment.pythonVersion;

        try {
            // Parse the token stream, building the abstract syntax tree.
            const parser = new Parser();
            const parseResults = parser.parseSourceFile(fileContents!, parseOptions, diagSink);
            this._analysisJob.parseResults = parseResults;

            // Resolve imports.
            timingStats.resolveImportsTime.timeOperation(() => {
                [this._analysisJob.imports, this._analysisJob.builtinsImport, this._analysisJob.typingModulePath] =
                    this._resolveImports(importResolver, parseResults.importedModules, execEnvironment);
                this._analysisJob.parseDiagnostics = diagSink.diagnostics;
            });

            // Is this file in a "strict" path?
            const useStrict = configOptions.strict.find(
                strictFileSpec => strictFileSpec.regExp.test(this._filePath)) !== undefined;

            this._analysisJob.diagnosticSettings = CommentUtils.getFileLevelDirectives(
                this._analysisJob.parseResults.tokens, configOptions.diagnosticSettings,
                useStrict);
        } catch (e) {
            const message: string = (e.stack ? e.stack.toString() : undefined) ||
                (typeof e.message === 'string' ? e.message : undefined) ||
                JSON.stringify(e);
            this._console.log(
                `An internal error occurred while parsing ${ this.getFilePath() }: ` + message);

            // Create dummy parse results.
            this._analysisJob.parseResults = {
                parseTree: ModuleNode.create({ start: 0, length: 0 }),
                importedModules: [],
                futureImports: new StringMap<boolean>(),
                tokens: new TextRangeCollection<Token>([]),
                lines: new TextRangeCollection<TextRange>([]),
                predominantLineEndSequence: '\n',
                predominantTabSequence: '    '
            };
            this._analysisJob.imports = undefined;
            this._analysisJob.builtinsImport = undefined;

            const diagSink = new DiagnosticSink();
            diagSink.addError(`An internal error occurred while parsing file`, getEmptyRange());
            this._analysisJob.parseDiagnostics = diagSink.diagnostics;
        }

        this._analysisJob.fileContentsVersion = this._fileContentsVersion;
        this._analysisJob.nextPhaseToRun = AnalysisPhase.Bind;
        this._analysisJob.parseTreeNeedsCleaning = false;
        this._analysisJob.hitMaxImportDepth = undefined;
        this._diagnosticVersion++;

        return true;
    }

    getDefinitionsForPosition(position: DiagnosticTextPosition): DocumentTextRange[] | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._analysisJob.parseResults) {
            return undefined;
        }

        return DefinitionProvider.getDefinitionsForPosition(
                this._analysisJob.parseResults, position);
    }

    getReferencesForPosition(position: DiagnosticTextPosition, includeDeclaration: boolean):
            ReferencesResult | undefined {

        // If we have no completed analysis job, there's nothing to do.
        if (!this._analysisJob.parseResults) {
            return undefined;
        }

        return ReferencesProvider.getReferencesForPosition(
            this._analysisJob.parseResults, this._filePath, position, includeDeclaration);
    }

    addReferences(referencesResult: ReferencesResult, includeDeclaration: boolean): void {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._analysisJob.parseResults) {
            return;
        }

        ReferencesProvider.addReferences(
            this._analysisJob.parseResults, this._filePath, referencesResult, includeDeclaration);
    }

    addSymbolsForDocument(symbolList: SymbolInformation[], query?: string) {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._analysisJob.parseResults) {
            return;
        }

        DocumentSymbolProvider.addSymbolsForDocument(symbolList, query,
            this._filePath, this._analysisJob.parseResults);
    }

    getHoverForPosition(position: DiagnosticTextPosition, importMap: ImportMap): HoverResults | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._analysisJob.parseResults) {
            return undefined;
        }

        return HoverProvider.getHoverForPosition(
            this._analysisJob.parseResults, position, importMap);
    }

    getSignatureHelpForPosition(position: DiagnosticTextPosition): SignatureHelpResults | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._analysisJob.parseResults) {
            return undefined;
        }

        // This command should be called only for open files, in which
        // case we should have the file contents already loaded.
        if (this._fileContents === undefined) {
            return undefined;
        }

        return SignatureHelpProvider.getSignatureHelpForPosition(
            this._analysisJob.parseResults, this._fileContents, position);
    }

    getCompletionsForPosition(position: DiagnosticTextPosition,
            configOptions: ConfigOptions, importResolver: ImportResolver,
            importMapCallback: () => ImportMap,
            moduleSymbolsCallback: () => ModuleSymbolMap): CompletionList | undefined {

        // If we have no completed analysis job, there's nothing to do.
        if (!this._analysisJob.parseResults) {
            return undefined;
        }

        // This command should be called only for open files, in which
        // case we should have the file contents already loaded.
        if (this._fileContents === undefined) {
            return undefined;
        }

        const completionProvider = new CompletionProvider(
            this._analysisJob.parseResults, this._fileContents,
            importResolver, position,
            this._filePath, configOptions, importMapCallback,
            moduleSymbolsCallback);

        return completionProvider.getCompletionsForPosition();
    }

    performQuickAction(command: string, args: any[]): TextEditAction[] | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._analysisJob.parseResults) {
            return undefined;
        }

        // This command should be called only for open files, in which
        // case we should have the file contents already loaded.
        if (this._fileContents === undefined) {
            return undefined;
        }

        return performQuickAction(command, args, this._analysisJob.parseResults);
    }

    getAnalysisPassCount() {
        return this._analysisJob.typeAnalysisPassNumber - 1;
    }

    getLastReanalysisReason() {
        return this._analysisJob.lastReanalysisReason;
    }

    setTypeAnalysisPassNeeded() {
        this._analysisJob.isTypeAnalysisPassNeeded = true;
        this._analysisJob.isTypeAnalysisFinalized = false;
    }

    bind(configOptions: ConfigOptions, builtinsScope?: Scope) {
        assert.ok(!this.isParseRequired());
        assert.ok(this.isBindingRequired());
        assert.ok(this._analysisJob.parseResults);
        assert.ok(this._analysisJob.nextPhaseToRun === AnalysisPhase.Bind);

        try {
            // Perform name binding.
            timingStats.bindTime.timeOperation(() => {
                const fileInfo = this._buildFileInfo(configOptions, undefined, builtinsScope);
                this._cleanParseTreeIfRequired();

                const binder = new ModuleScopeBinder(
                    this._analysisJob.parseResults!.parseTree, fileInfo);
                binder.bind();

                // If we're in "test mode" (used for unit testing), run an additional
                // "test walker" over the parse tree to validate its internal consistency.
                if (configOptions.internalTestMode) {
                    const testWalker = new TestWalker();
                    testWalker.walk(this._analysisJob.parseResults!.parseTree);
                }

                this._analysisJob.bindDiagnostics = fileInfo.diagnosticSink.diagnostics;
                const moduleScope = AnalyzerNodeInfo.getScope(this._analysisJob.parseResults!.parseTree);
                assert.ok(moduleScope !== undefined);
                this._analysisJob.moduleSymbolTable = moduleScope!.getSymbolTable();
                const moduleType = AnalyzerNodeInfo.getExpressionType(
                    this._analysisJob.parseResults!.parseTree);
                assert.ok(moduleType && moduleType.category === TypeCategory.Module);
                this._analysisJob.moduleType = moduleType as ModuleType;
            });
        } catch (e) {
            const message: string = (e.stack ? e.stack.toString() : undefined) ||
                (typeof e.message === 'string' ? e.message : undefined) ||
                JSON.stringify(e);
            this._console.log(
                `An internal error occurred while performing name binding for ${ this.getFilePath() }: ` + message);

            const diagSink = new DiagnosticSink();
            diagSink.addError(`An internal error occurred while performing name binding`,
                getEmptyRange());
            this._analysisJob.bindDiagnostics = diagSink.diagnostics;
        }

        // Prepare for the next stage of the analysis.
        this._analysisJob.nextPhaseToRun = AnalysisPhase.TypeAnalysis;
        this._diagnosticVersion++;
        this._analysisJob.typeAnalysisPassNumber = 1;
        this._analysisJob.lastReanalysisReason = '';
        this._analysisJob.circularDependencies = [];
        this._analysisJob.isTypeAnalysisPassNeeded = true;
        this._analysisJob.isTypeAnalysisFinalized = false;
        this._analysisJob.nextPhaseToRun = AnalysisPhase.TypeAnalysis;
    }

    doTypeAnalysis(configOptions: ConfigOptions, importMap: ImportMap) {
        assert.ok(!this.isParseRequired());
        assert.ok(!this.isBindingRequired());
        assert.ok(this.isTypeAnalysisRequired());
        assert.ok(this._analysisJob.parseResults);
        assert.ok(this._analysisJob.nextPhaseToRun === AnalysisPhase.TypeAnalysis);

        try {
            timingStats.typeAnalyzerTime.timeOperation(() => {
                const fileInfo = this._buildFileInfo(configOptions, importMap, undefined);

                // Perform static type analysis.
                const typeAnalyzer = new TypeAnalyzer(this._analysisJob.parseResults!.parseTree,
                    fileInfo, this._analysisJob.typeAnalysisPassNumber);
                this._analysisJob.typeAnalysisPassNumber++;

                // Repeatedly call the analyzer until everything converges.
                this._analysisJob.isTypeAnalysisPassNeeded = typeAnalyzer.analyze();
                this._analysisJob.typeAnalysisLastPassDiagnostics = fileInfo.diagnosticSink.diagnostics;
                if (this._analysisJob.isTypeAnalysisPassNeeded) {
                    this._analysisJob.lastReanalysisReason = typeAnalyzer.getLastReanalysisReason();
                }
            });
        } catch (e) {
            const message: string = (e.stack ? e.stack.toString() : undefined) ||
                (typeof e.message === 'string' ? e.message : undefined) ||
                JSON.stringify(e);
            this._console.log(
                `An internal error occurred while while performing type analysis for ${ this.getFilePath() }: ` + message);
            const diagSink = new DiagnosticSink();
            diagSink.addError(`An internal error occurred while performing type analysis`,
                getEmptyRange());

            // Mark the file as complete so we don't get into an infinite loop.
            this._analysisJob.isTypeAnalysisPassNeeded = false;
            this._analysisJob.typeAnalysisLastPassDiagnostics = diagSink.diagnostics;
        }
    }

    // This method should be called once type analysis has completed for
    // this file and all of its dependent files.
    finalizeAnalysis() {
        assert.ok(!this.isTypeAnalysisRequired());

        // Mark the type analysis as final.
        this._analysisJob.isTypeAnalysisFinalized = true;

        // Finalize the diagnostics from the last pass of type analysis
        // so they become visible.
        this._analysisJob.typeAnalysisFinalDiagnostics =
            this._analysisJob.typeAnalysisLastPassDiagnostics;
        this._analysisJob.typeAnalysisLastPassDiagnostics = [];
        this._diagnosticVersion++;
    }

    private _buildFileInfo(configOptions: ConfigOptions, importMap?: ImportMap, builtinsScope?: Scope) {
        assert.ok(this._analysisJob.parseResults !== undefined);
        const analysisDiagnostics = new TextRangeDiagnosticSink(this._analysisJob.parseResults!.lines);

        const fileInfo: AnalyzerFileInfo = {
            importMap: importMap || {},
            futureImports: this._analysisJob.parseResults!.futureImports,
            builtinsScope,
            typingModulePath: this._analysisJob.typingModulePath,
            diagnosticSink: analysisDiagnostics,
            executionEnvironment: configOptions.findExecEnvironment(this._filePath),
            diagnosticSettings: this._analysisJob.diagnosticSettings,
            lines: this._analysisJob.parseResults!.lines,
            filePath: this._filePath,
            isStubFile: this._isStubFile,
            isTypingStubFile: this._isTypingStubFile,
            isBuiltInStubFile: this._isBuiltInStubFile,
            console: this._console
        };
        return fileInfo;
    }

    private _cleanParseTreeIfRequired() {
        if (this._analysisJob && this._analysisJob.parseResults) {
            if (this._analysisJob.parseTreeNeedsCleaning) {
                const cleanerWalker = new ParseTreeCleanerWalker(
                    this._analysisJob.parseResults.parseTree);
                cleanerWalker.clean();
                this._analysisJob.parseTreeNeedsCleaning = false;
            }
        }
    }

    private _resolveImports(importResolver: ImportResolver,
            moduleImports: ModuleImport[],
            execEnv: ExecutionEnvironment):
            [ImportResult[], ImportResult?, string?] {

        const imports: ImportResult[] = [];

        // Always include an implicit import of the builtins module.
        let builtinsImportResult: ImportResult | undefined = importResolver.resolveImport(
            this._filePath,
            execEnv,
            {
                leadingDots: 0,
                nameParts: ['builtins'],
                importedSymbols: undefined
            }
        );

        // Avoid importing builtins from the builtins.pyi file itself.
        if (builtinsImportResult.resolvedPaths.length === 0 ||
                builtinsImportResult.resolvedPaths[0] !== this.getFilePath()) {
            imports.push(builtinsImportResult);
        } else {
            builtinsImportResult = undefined;
        }

        // Always include an implicit import of the typing module.
        const typingImportResult: ImportResult | undefined = importResolver.resolveImport(
            this._filePath,
            execEnv,
            {
                leadingDots: 0,
                nameParts: ['typing'],
                importedSymbols: undefined
            }
        );

        // Avoid importing typing from the typing.pyi file itself.
        let typingModulePath: string | undefined;
        if (typingImportResult.resolvedPaths.length === 0 ||
                typingImportResult.resolvedPaths[0] !== this.getFilePath()) {
            imports.push(typingImportResult);
            typingModulePath = typingImportResult.resolvedPaths[0];
        }

        for (const moduleImport of moduleImports) {
            const importResult = importResolver.resolveImport(
                this._filePath,
                execEnv,
                {
                    leadingDots: moduleImport.leadingDots,
                    nameParts: moduleImport.nameParts,
                    importedSymbols: moduleImport.importedSymbols
                }
            );
            imports.push(importResult);

            // Associate the import results with the module import
            // name node in the parse tree so we can access it later
            // (for hover and definition support).
            AnalyzerNodeInfo.setImportInfo(moduleImport.nameNode, importResult);
        }

        return [imports, builtinsImportResult, typingModulePath];
    }
}
