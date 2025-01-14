/*
* testWalker.ts
*
* Walks a parse tree to validate internal consistency and completeness.
*/

import * as assert from 'assert';

import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { TextRange } from '../common/textRange';
import { ParseNode, ParseNodeArray, ParseNodeType } from '../parser/parseNodes';

export class TestWalker extends ParseTreeWalker {
    constructor() {
        super();
    }

    visitNode(node: ParseNode) {
        const children = super.visitNode(node);
        this._verifyParentChildLinks(node, children);
        this._verifyChildRanges(node, children);

        return children;
    }

    // Make sure that all of the children point to their parent.
    private _verifyParentChildLinks(node: ParseNode, children: ParseNodeArray) {
        children.forEach(child => {
            if (child) {
                assert.equal(child.parent, node);
            }
        });
    }

    // Verify that:
    //      Children are all contained within the parent
    //      Children have non-overlapping ranges
    //      Children are listed in increasing order
    private _verifyChildRanges(node: ParseNode, children: ParseNodeArray) {
        let prevNode: ParseNode | undefined;

        children.forEach(child => {
            if (child) {
                let skipCheck = false;

                // There are a few exceptions we need to deal with here. Comment
                // annotations can occur outside of an assignment node's range.
                if (node.nodeType === ParseNodeType.Assignment) {
                    if (child === node.typeAnnotationComment) {
                        skipCheck = true;
                    }
                }

                if (node.nodeType === ParseNodeType.StringList) {
                    if (child === node.typeAnnotation) {
                        skipCheck = true;
                    }
                }

                if (!skipCheck) {
                    // Make sure the child is contained within the parent.
                    assert(child.start >= node.start && TextRange.getEnd(child) <= TextRange.getEnd(node));
                    if (prevNode) {
                        // Make sure the child is after the previous child.
                        assert(child.start >= TextRange.getEnd(prevNode));
                    }

                    prevNode = child;
                }
            }
        });
    }
}
