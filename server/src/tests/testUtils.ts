/*
* testUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility functions that are common to a bunch of the tests.
*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { AnalyzerFileInfo } from '../analyzer/analyzerFileInfo';
import { ModuleScopeBinder } from '../analyzer/binder';
import { ImportResolver } from '../analyzer/importResolver';
import { Program } from '../analyzer/program';
import { cloneDiagnosticSettings, ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { StandardConsole } from '../common/console';
import { Diagnostic, DiagnosticCategory } from '../common/diagnostic';
import { DiagnosticSink, TextRangeDiagnosticSink } from '../common/diagnosticSink';
import StringMap from '../common/stringMap';
import { ParseOptions, Parser, ParseResults } from '../parser/parser';
import { TestWalker } from './testWalker';

// This is a bit gross, but it's necessary to allow the fallback typeshed
// directory to be located when running within the jest environment. This
// assumes that the working directory has been set appropriately before
// running the tests.
(global as any).__rootDirectory = path.resolve('../client');

export interface FileAnalysisResult {
    filePath: string;
    parseResults?: ParseResults;
    errors: Diagnostic[];
    warnings: Diagnostic[];
}

export function resolveSampleFilePath(fileName: string): string {
    return path.resolve(path.dirname(module.filename), `./samples/${ fileName }`);
}

export function readSampleFile(fileName: string): string {
    const filePath = resolveSampleFilePath(fileName);

    try {
        return fs.readFileSync(filePath, { encoding: 'utf8' });
    } catch {
        console.error(`Could not read file "${ fileName }"`);
        return '';
    }
}

export function parseText(textToParse: string, diagSink: DiagnosticSink,
    parseOptions: ParseOptions = new ParseOptions()): ParseResults {

    const parser = new Parser();
    return parser.parseSourceFile(textToParse, parseOptions, diagSink);
}

export function parseSampleFile(fileName: string, diagSink: DiagnosticSink,
        execEnvironment = new ExecutionEnvironment('.')): ParseResults {

    const text = readSampleFile(fileName);
    const parseOptions = new ParseOptions();
    if (fileName.endsWith('pyi')) {
        parseOptions.isStubFile = true;
    }
    parseOptions.pythonVersion = execEnvironment.pythonVersion;

    return parseText(text, diagSink);
}

export function buildAnalyzerFileInfo(filePath: string, parseResults: ParseResults,
        configOptions: ConfigOptions): AnalyzerFileInfo {

    const analysisDiagnostics = new TextRangeDiagnosticSink(parseResults.lines);

    const fileInfo: AnalyzerFileInfo = {
        importMap: {},
        futureImports: new StringMap<boolean>(),
        builtinsScope: undefined,
        diagnosticSink: analysisDiagnostics,
        executionEnvironment: configOptions.findExecEnvironment(filePath),
        diagnosticSettings: cloneDiagnosticSettings(configOptions.diagnosticSettings),
        lines: parseResults.lines,
        filePath,
        isStubFile: filePath.endsWith('.pyi'),
        isTypingStubFile: false,
        isBuiltInStubFile: false,
        console: new StandardConsole()
    };

    return fileInfo;
}

export function bindSampleFile(fileName: string,
        configOptions = new ConfigOptions('.')): FileAnalysisResult {

    const diagSink = new DiagnosticSink();
    const filePath = resolveSampleFilePath(fileName);
    const execEnvironment = configOptions.findExecEnvironment(filePath);
    const parseResults = parseSampleFile(fileName, diagSink, execEnvironment);

    const fileInfo = buildAnalyzerFileInfo(filePath, parseResults, configOptions);
    const binder = new ModuleScopeBinder(parseResults.parseTree, fileInfo);
    binder.bind();

    // Walk the AST to verify internal consistency.
    const testWalker = new TestWalker();
    testWalker.walk(parseResults.parseTree);

    return {
        filePath,
        parseResults,
        errors: fileInfo.diagnosticSink.getErrors(),
        warnings: fileInfo.diagnosticSink.getWarnings()
    };
}

export function typeAnalyzeSampleFiles(fileNames: string[],
        configOptions = new ConfigOptions('.')): FileAnalysisResult[] {

    const program = new Program();
    const filePaths = fileNames.map(name => resolveSampleFilePath(name));
    program.setTrackedFiles(filePaths);

    // Always enable "test mode".
    configOptions.internalTestMode = true;
    const importResolver = new ImportResolver(configOptions);

    while (program.analyze(configOptions, importResolver)) {
        // Continue to call analyze until it completes. Since we're not
        // specifying a timeout, it should complete the first time.
    }

    const sourceFiles = filePaths.map(filePath => program.getSourceFile(filePath));
    return sourceFiles.map((sourceFile, index) => {
        if (sourceFile) {
            const diagnostics = sourceFile.getDiagnostics(configOptions) || [];
            const analysisResult: FileAnalysisResult = {
                filePath: sourceFile.getFilePath(),
                parseResults: sourceFile.getParseResults(),
                errors: diagnostics.filter(diag => diag.category === DiagnosticCategory.Error),
                warnings: diagnostics.filter(diag => diag.category === DiagnosticCategory.Warning)
            };
            return analysisResult;
        } else {
            assert(false, `Source file not found for ${ filePaths[index] }`);

            const analysisResult: FileAnalysisResult = {
                filePath: '',
                parseResults: undefined,
                errors: [],
                warnings: []
            };
            return analysisResult;
        }
    });
}

export function printDiagnostics(fileResults: FileAnalysisResult) {
    if (fileResults.errors.length > 0) {
        console.error(`Errors in ${ fileResults.filePath }:`);
        for (const diag of fileResults.errors) {
            console.error(`  ${ diag.message }`);
        }
    }

    if (fileResults.warnings.length > 0) {
        console.error(`Warnings in ${ fileResults.filePath }:`);
        for (const diag of fileResults.warnings) {
            console.error(`  ${ diag.message }`);
        }
    }
}
