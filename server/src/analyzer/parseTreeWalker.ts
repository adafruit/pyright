/*
* parseTreeWalker.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Class that traverses a parse tree.
*/

import * as assert from 'assert';

import { ArgumentNode, AssertNode, AssignmentNode, AugmentedAssignmentExpressionNode,
    AwaitExpressionNode, BinaryExpressionNode, BreakNode, CallExpressionNode, ClassNode,
    ConstantNode, ContinueNode, DecoratorNode, DelNode, DictionaryExpandEntryNode,
    DictionaryKeyEntryNode, DictionaryNode, EllipsisNode, ErrorExpressionNode,
    ExceptNode, FormatStringNode, ForNode, FunctionNode, GlobalNode, IfNode, ImportAsNode,
    ImportFromAsNode, ImportFromNode, ImportNode, IndexExpressionNode, IndexItemsNode,
    LambdaNode, ListComprehensionForNode, ListComprehensionIfNode, ListComprehensionNode,
    ListNode, MemberAccessExpressionNode, ModuleNameNode, ModuleNode, NameNode, NonlocalNode,
    NumberNode, ParameterNode, ParseNode, ParseNodeArray, ParseNodeType, PassNode,
    RaiseNode, ReturnNode, SetNode, SliceExpressionNode, StatementListNode, StringListNode,
    StringNode, SuiteNode, TernaryExpressionNode, TryNode, TupleExpressionNode,
    TypeAnnotationExpressionNode, UnaryExpressionNode, UnpackExpressionNode, WhileNode,
    WithItemNode, WithNode, YieldExpressionNode, YieldFromExpressionNode } from '../parser/parseNodes';

// To use this class, create a subclass and override the
// visitXXX methods that you want to handle.
export class ParseTreeWalker {
    walk(node: ParseNode): void {
        const childrenToWalk = this.visitNode(node);
        if (childrenToWalk.length > 0) {
            this.walkMultiple(childrenToWalk);
        }
    }

    walkMultiple(nodes: ParseNodeArray) {
        nodes.forEach(node => {
            if (node) {
                this.walk(node);
            }
        });
    }

    // Calls the node-specific method (visitXXXX). If the method
    // returns true, all child nodes for the node are returned.
    // If the method returns false, we assume that the handler
    // has already handled the child nodes, so an empty list is
    // returned.
    visitNode(node: ParseNode): ParseNodeArray {
        switch (node.nodeType) {
            case ParseNodeType.Argument:
                if (this.visitArgument(node)) {
                    return [node.valueExpression];
                }
                break;

            case ParseNodeType.Assert:
                if (this.visitAssert(node)) {
                    return [node.testExpression, node.exceptionExpression];
                }
                break;

            case ParseNodeType.Assignment:
                if (this.visitAssignment(node)) {
                    return [node.leftExpression, node.rightExpression, node.typeAnnotationComment];
                }
                break;

            case ParseNodeType.AugmentedAssignment:
                if (this.visitAugmentedAssignment(node)) {
                    return [node.leftExpression, node.rightExpression];
                }
                break;

            case ParseNodeType.Await:
                if (this.visitAwait(node)) {
                    return [node.expression];
                }
                break;

            case ParseNodeType.BinaryOperation:
                if (this.visitBinaryOperation(node)) {
                    return [node.leftExpression, node.rightExpression];
                }
                break;

            case ParseNodeType.Break:
                if (this.visitBreak(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Call:
                if (this.visitCall(node)) {
                    return [node.leftExpression, ...node.arguments];
                }
                break;

            case ParseNodeType.Class:
                if (this.visitClass(node)) {
                    return [...node.decorators, node.name, ...node.arguments, node.suite];
                }
                break;

            case ParseNodeType.Ternary:
                if (this.visitTernary(node)) {
                    return [node.ifExpression, node.testExpression, node.elseExpression];
                }
                break;

            case ParseNodeType.Constant:
                if (this.visitConstant(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Continue:
                if (this.visitContinue(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Decorator:
                if (this.visitDecorator(node)) {
                    return [node.leftExpression, ...(node.arguments || [])];
                }
                break;

            case ParseNodeType.Del:
                if (this.visitDel(node)) {
                    return node.expressions;
                }
                break;

            case ParseNodeType.Dictionary:
                if (this.visitDictionary(node)) {
                    return node.entries;
                }
                break;

            case ParseNodeType.DictionaryKeyEntry:
                if (this.visitDictionaryKeyEntry(node)) {
                    return [node.keyExpression, node.valueExpression];
                }
                break;

            case ParseNodeType.DictionaryExpandEntry:
                if (this.visitDictionaryExpandEntry(node)) {
                    return [node.expandExpression];
                }
                break;

            case ParseNodeType.Error:
                if (this.visitError(node)) {
                    return [node.child];
                }
                break;

            case ParseNodeType.If:
                if (this.visitIf(node)) {
                    return [node.testExpression, node.ifSuite, node.elseSuite];
                }
                break;

            case ParseNodeType.Import:
                if (this.visitImport(node)) {
                    return node.list;
                }
                break;

            case ParseNodeType.ImportAs:
                if (this.visitImportAs(node)) {
                    return [node.module, node.alias];
                }
                break;

            case ParseNodeType.ImportFrom:
                if (this.visitImportFrom(node)) {
                    return [node.module, ...node.imports];
                }
                break;

            case ParseNodeType.ImportFromAs:
                if (this.visitImportFromAs(node)) {
                    return [node.name, node.alias];
                }
                break;

            case ParseNodeType.Index:
                if (this.visitIndex(node)) {
                    return [node.baseExpression, node.items];
                }
                break;

            case ParseNodeType.IndexItems:
                if (this.visitIndexItems(node)) {
                    return node.items;
                }
                break;

            case ParseNodeType.Ellipsis:
                if (this.visitEllipsis(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Except:
                if (this.visitExcept(node)) {
                    return [node.typeExpression, node.name, node.exceptSuite];
                }
                break;

            case ParseNodeType.For:
                if (this.visitFor(node)) {
                    return [node.targetExpression, node.iterableExpression, node.forSuite, node.elseSuite];
                }
                break;

            case ParseNodeType.FormatString:
                if (this.visitFormatString(node)) {
                    return node.expressions;
                }
                break;

            case ParseNodeType.Function:
                if (this.visitFunction(node)) {
                    return [...node.decorators, node.name, ...node.parameters,
                        node.returnTypeAnnotation, node.suite];
                }
                break;

            case ParseNodeType.Global:
                if (this.visitGlobal(node)) {
                    return node.nameList;
                }
                break;

            case ParseNodeType.Lambda:
                if (this.visitLambda(node)) {
                    return [...node.parameters, node.expression];
                }
                break;

            case ParseNodeType.List:
                if (this.visitList(node)) {
                    return node.entries;
                }
                break;

            case ParseNodeType.ListComprehension:
                if (this.visitListComprehension(node)) {
                    return [node.expression, ...node.comprehensions];
                }
                break;

            case ParseNodeType.ListComprehensionFor:
                if (this.visitListComprehensionFor(node)) {
                    return [node.targetExpression, node.iterableExpression];
                }
                break;

            case ParseNodeType.ListComprehensionIf:
                if (this.visitListComprehensionIf(node)) {
                    return [node.testExpression];
                }
                break;

            case ParseNodeType.MemberAccess:
                if (this.visitMemberAccess(node)) {
                    return [node.leftExpression, node.memberName];
                }
                break;

            case ParseNodeType.Module:
                if (this.visitModule(node)) {
                    return [...node.statements];
                }
                break;

            case ParseNodeType.ModuleName:
                if (this.visitModuleName(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Name:
                if (this.visitName(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Nonlocal:
                if (this.visitNonlocal(node)) {
                    return node.nameList;
                }
                break;

            case ParseNodeType.Number:
                if (this.visitNumber(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Parameter:
                if (this.visitParameter(node)) {
                    return [node.name, node.typeAnnotation, node.defaultValue];
                }
                break;

            case ParseNodeType.Pass:
                if (this.visitPass(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Raise:
                if (this.visitRaise(node)) {
                    return [node.typeExpression, node.valueExpression, node.tracebackExpression];
                }
                break;

            case ParseNodeType.Return:
                if (this.visitReturn(node)) {
                    return [node.returnExpression];
                }
                break;

            case ParseNodeType.Set:
                if (this.visitSet(node)) {
                    return node.entries;
                }
                break;

            case ParseNodeType.Slice:
                if (this.visitSlice(node)) {
                    return [node.startValue, node.endValue, node.stepValue];
                }
                break;

            case ParseNodeType.StatementList:
                if (this.visitStatementList(node)) {
                    return node.statements;
                }
                break;

            case ParseNodeType.String:
                if (this.visitString(node)) {
                    return [];
                }
                break;

            case ParseNodeType.StringList:
                if (this.visitStringList(node)) {
                    return [node.typeAnnotation, ...node.strings];
                }
                break;

            case ParseNodeType.Suite:
                if (this.visitSuite(node)) {
                    return [...node.statements];
                }
                break;

            case ParseNodeType.Tuple:
                if (this.visitTuple(node)) {
                    return node.expressions;
                }
                break;

            case ParseNodeType.Try:
                if (this.visitTry(node)) {
                    return [node.trySuite, ...node.exceptClauses, node.elseSuite, node.finallySuite];
                }
                break;

            case ParseNodeType.TypeAnnotation:
                if (this.visitTypeAnnotation(node)) {
                    return [node.valueExpression, node.typeAnnotation];
                }
                break;

            case ParseNodeType.UnaryOperation:
                if (this.visitUnaryOperation(node)) {
                    return [node.expression];
                }
                break;

            case ParseNodeType.Unpack:
                if (this.visitUnpack(node)) {
                    return [node.expression];
                }
                break;

            case ParseNodeType.While:
                if (this.visitWhile(node)) {
                    return [node.testExpression, node.whileSuite, node.elseSuite];
                }
                break;

            case ParseNodeType.With:
                if (this.visitWith(node)) {
                    return [...node.withItems, node.suite];
                }
                break;

            case ParseNodeType.WithItem:
                if (this.visitWithItem(node)) {
                    return [node.expression, node.target];
                }
                break;

            case ParseNodeType.Yield:
                if (this.visitYield(node)) {
                    return [node.expression];
                }
                break;

            case ParseNodeType.YieldFrom:
                if (this.visitYieldFrom(node)) {
                    return [node.expression];
                }
                break;

            default:
                assert.fail('Unexpected node type');
                break;
        }

        return [];
    }

    // Override these methods as necessary.
    visitArgument(node: ArgumentNode) {
        return true;
    }

    visitAssert(node: AssertNode) {
        return true;
    }

    visitAssignment(node: AssignmentNode) {
        return true;
    }

    visitAugmentedAssignment(node: AugmentedAssignmentExpressionNode) {
        return true;
    }

    visitAwait(node: AwaitExpressionNode) {
        return true;
    }

    visitBinaryOperation(node: BinaryExpressionNode) {
        return true;
    }

    visitBreak(node: BreakNode) {
        return true;
    }

    visitCall(node: CallExpressionNode) {
        return true;
    }

    visitClass(node: ClassNode) {
        return true;
    }

    visitTernary(node: TernaryExpressionNode) {
        return true;
    }

    visitContinue(node: ContinueNode) {
        return true;
    }

    visitConstant(node: ConstantNode) {
        return true;
    }

    visitDecorator(node: DecoratorNode) {
        return true;
    }

    visitDel(node: DelNode) {
        return true;
    }

    visitDictionary(node: DictionaryNode) {
        return true;
    }

    visitDictionaryKeyEntry(node: DictionaryKeyEntryNode) {
        return true;
    }

    visitDictionaryExpandEntry(node: DictionaryExpandEntryNode) {
        return true;
    }

    visitError(node: ErrorExpressionNode) {
        return true;
    }

    visitEllipsis(node: EllipsisNode) {
        return true;
    }

    visitIf(node: IfNode) {
        return true;
    }

    visitImport(node: ImportNode) {
        return true;
    }

    visitImportAs(node: ImportAsNode) {
        return true;
    }

    visitImportFrom(node: ImportFromNode) {
        return true;
    }

    visitImportFromAs(node: ImportFromAsNode) {
        return true;
    }

    visitIndex(node: IndexExpressionNode) {
        return true;
    }

    visitIndexItems(node: IndexItemsNode) {
        return true;
    }

    visitExcept(node: ExceptNode) {
        return true;
    }

    visitFor(node: ForNode) {
        return true;
    }

    visitFormatString(node: FormatStringNode) {
        return true;
    }

    visitFunction(node: FunctionNode) {
        return true;
    }

    visitGlobal(node: GlobalNode) {
        return true;
    }

    visitLambda(node: LambdaNode) {
        return true;
    }

    visitList(node: ListNode) {
        return true;
    }

    visitListComprehension(node: ListComprehensionNode) {
        return true;
    }

    visitListComprehensionFor(node: ListComprehensionForNode) {
        return true;
    }

    visitListComprehensionIf(node: ListComprehensionIfNode) {
        return true;
    }

    visitMemberAccess(node: MemberAccessExpressionNode) {
        return true;
    }

    visitModule(node: ModuleNode) {
        return true;
    }

    visitModuleName(node: ModuleNameNode) {
        return true;
    }

    visitName(node: NameNode) {
        return true;
    }

    visitNonlocal(node: NonlocalNode) {
        return true;
    }

    visitNumber(node: NumberNode) {
        return true;
    }

    visitParameter(node: ParameterNode) {
        return true;
    }

    visitPass(node: PassNode) {
        return true;
    }

    visitRaise(node: RaiseNode) {
        return true;
    }

    visitReturn(node: ReturnNode) {
        return true;
    }

    visitSet(node: SetNode) {
        return true;
    }

    visitSlice(node: SliceExpressionNode) {
        return true;
    }

    visitStatementList(node: StatementListNode) {
        return true;
    }

    visitString(node: StringNode) {
        return true;
    }

    visitStringList(node: StringListNode) {
        return true;
    }

    visitSuite(node: SuiteNode) {
        return true;
    }

    visitTuple(node: TupleExpressionNode) {
        return true;
    }

    visitTry(node: TryNode) {
        return true;
    }

    visitTypeAnnotation(node: TypeAnnotationExpressionNode) {
        return true;
    }

    visitUnaryOperation(node: UnaryExpressionNode) {
        return true;
    }

    visitUnpack(node: UnpackExpressionNode) {
        return true;
    }

    visitWhile(node: WhileNode) {
        return true;
    }

    visitWith(node: WithNode) {
        return true;
    }

    visitWithItem(node: WithItemNode) {
        return true;
    }

    visitYield(node: YieldExpressionNode) {
        return true;
    }

    visitYieldFrom(node: YieldFromExpressionNode) {
        return true;
    }
}
