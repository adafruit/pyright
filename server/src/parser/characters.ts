/*
* characters.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Based on code from vscode-python repository:
*  https://github.com/Microsoft/vscode-python
*
* Utility routines used by tokenizer.
*/

import * as unicode from './unicode';

export const enum Char {
	// C0 control codes
	Null = 0,
	StartOfHeading = 1,
	StartOfText = 2,
	EndOfText = 3,
	EndOfTransmission = 4,
	Enquiry = 5,
	Acknowledge = 6,
	Bell = 7,
	Backspace = 8,
	Tab = 9,
	LineFeed = 0xa,
	VerticalTab = 0xb,
	FormFeed = 0xc,
	CarriageReturn = 0xd,
	ShiftOut = 0xe,
	ShirtIn = 0xf,
	DataLineEscape = 0x10,
	DeviceControl1 = 0x11,
	DeviceControl2 = 0x12,
	DeviceControl3 = 0x13,
	DeviceControl4 = 0x14,
	NegativeAcknowledgement = 0x15,
	SynchronousIdle = 0x16,
	EndOfTransmitBlock = 0x17,
	Cancel = 0x18,
	EndOfMedium = 0x19,
	Substitute = 0x1a,
	Escape = 0x1b,
	FileSeparator = 0x1c,
	GroupSeparator = 0x1d,
	RecordSeparator = 0x1e,
	UnitSeparator = 0x1f,

	// Printable characters
	Space = 0x20,
	ExclamationMark = 0x21,
	DoubleQuote = 0x22,
	Hash = 0x23,
	$ = 0x24,
	Percent = 0x25,
	Ampersand = 0x26,
	SingleQuote = 0x27,
	OpenParenthesis = 0x28,
	CloseParenthesis = 0x29,
	Asterisk = 0x2a,
	Plus = 0x2b,
	Comma = 0x2c,
	Hyphen = 0x2d,
	Period = 0x2e,
	Slash = 0x2f,
	_0 = 0x30,
	_1 = 0x31,
	_2 = 0x32,
	_3 = 0x33,
	_4 = 0x34,
	_5 = 0x35,
	_6 = 0x36,
	_7 = 0x37,
	_8 = 0x38,
	_9 = 0x39,
	Colon = 0x3a,
	Semicolon = 0x3b,
	Less = 0x3c,
	Equal = 0x3d,
	Greater = 0x3e,
	QuestionMark = 0x3f,
	At = 0X40,
	A = 0x41,
	B = 0x42,
	C = 0x43,
	D = 0x44,
	E = 0x45,
	F = 0x46,
	G = 0x47,
	H = 0x48,
	I = 0x49,
	J = 0x4a,
	K = 0x4b,
	L = 0x4c,
	M = 0x4d,
	N = 0x4e,
	O = 0x4f,
	P = 0x50,
	Q = 0x51,
	R = 0x52,
	S = 0x53,
	T = 0x54,
	U = 0x55,
	V = 0x56,
	W = 0x57,
	X = 0x58,
	Y = 0x59,
	Z = 0x5a,
	OpenBracket = 0x5b,
	Backslash = 0x5c,
	CloseBracket = 0x5d,
	Caret = 0x5e,
	Underscore = 0x5f,
	Backtick = 0x60,
	a = 0x61,
	b = 0x62,
	c = 0x63,
	d = 0x64,
	e = 0x65,
	f = 0x66,
	g = 0x67,
	h = 0x68,
	i = 0x69,
	j = 0x6a,
	k = 0x6b,
	l = 0x6c,
	m = 0x6d,
	n = 0x6e,
	o = 0x6f,
	p = 0x70,
	q = 0x71,
	r = 0x72,
	s = 0x73,
	t = 0x74,
	u = 0x75,
	v = 0x76,
	w = 0x77,
	x = 0x78,
	y = 0x79,
	z = 0x7a,
	OpenBrace = 0x7b,
	Bar = 0x7c,
	CloseBrace = 0x7d,
	Tilde = 0x7e,
	Delete = 0x7f,

	// Other space characters
	NonBreakingSpace = 0xa0,
	EnQuad = 0x2000,
	EmQuad = 0x2001,
	EnSpace = 0x2002,
	EmSpace = 0x2003,
	ThreePerEmSpace = 0x2004,
	FourPerEmSpace = 0x2005,
	SixPerEmSpace = 0x2006,
	FigureSpace = 0x2007,
	PunctuationSpace = 0x2008,
	ThinSpace = 0x2009,
	HairSpace = 0x200a,
	ZeroWidthSpace = 0x200b,
	NarrowNoBreakSpace = 0x202f,
	IdeographicSpace = 0x3000,
	MathematicalSpace = 0x205f,
	Ogham = 0x1680
};

enum CharCategory {
    // Character cannot appear in identifier
    NotIdentifierChar = 0,

    // Character can appear at beginning or within identifier
    StartIdentifierChar = 1,

    // Character can appear only within identifier, not at beginning
    IdentifierChar = 2
}

// Table of first 256 character codes (the most common cases).
const _identifierCharFastTableSize = 256;
const _identifierCharFastTable: CharCategory[] = new Array(_identifierCharFastTableSize);

// Map of remaining characters that can appear within identifier.
const _identifierCharMap: { [code: number]: CharCategory } = {};

// We do lazy initialization of this map because it's rarely used.
let _identifierCharMapInitialized = false;

export function isIdentifierStartChar(ch: number) {
    if (ch < _identifierCharFastTableSize) {
        return _identifierCharFastTable[ch] === CharCategory.StartIdentifierChar;
    }

    // Lazy initialize the char map. We'll rarely get here.
    if (!_identifierCharMapInitialized) {
        _buildIdentifierLookupTable(false);
        _identifierCharMapInitialized = true;
    }

    return _identifierCharMap[ch] === CharCategory.StartIdentifierChar;
}

export function isIdentifierChar(ch: number) {
    if (ch < _identifierCharFastTableSize) {
        return _identifierCharFastTable[ch] === CharCategory.StartIdentifierChar ||
            _identifierCharFastTable[ch] === CharCategory.IdentifierChar;
    }

    return _identifierCharMap[ch] === CharCategory.StartIdentifierChar ||
        _identifierCharMap[ch] === CharCategory.IdentifierChar;
}

export function isWhiteSpace(ch: number): boolean {
    return ch === Char.Space || ch === Char.Tab || ch === Char.FormFeed;
}

export function isLineBreak(ch: number): boolean {
    return ch === Char.CarriageReturn || ch === Char.LineFeed;
}

export function isNumber(ch: number): boolean {
    return ch >= Char._0 && ch <= Char._9 || ch === Char.Underscore;
}

export function isDecimal(ch: number): boolean {
    return ch >= Char._0 && ch <= Char._9 || ch === Char.Underscore;
}

export function isHex(ch: number): boolean {
    return isDecimal(ch) || (ch >= Char.a && ch <= Char.f) || (ch >= Char.A && ch <= Char.F) || ch === Char.Underscore;
}

export function isOctal(ch: number): boolean {
    return ch >= Char._0 && ch <= Char._7 || ch === Char.Underscore;
}

export function isBinary(ch: number): boolean {
    return ch === Char._0 || ch === Char._1 || ch === Char.Underscore;
}

// Underscore is explicitly allowed to start an identifier.
// Characters with the Other_ID_Start property.
const _specialStartIdentifierChars: unicode.UnicodeRangeTable = [Char.Underscore,
    0x1885, 0x1886, 0x2118, 0x212E, 0x309B, 0x309C];

const _startIdentifierCharRanges = [_specialStartIdentifierChars, unicode.unicodeLu,
    unicode.unicodeLl, unicode.unicodeLt, unicode.unicodeLo, unicode.unicodeLm, unicode.unicodeNl];

// Characters with the Other_ID_Start property.
const _specialIdentifierChars: unicode.UnicodeRangeTable = [0x00B7, 0x0387, 0x1369,
    0x136A, 0x136B, 0x136C, 0x136D, 0x136E, 0x136F, 0x1370, 0x1371, 0x19DA];

const _identifierCharRanges = [_specialIdentifierChars, unicode.unicodeMn, unicode.unicodeMc,
    unicode.unicodeNd, unicode.unicodePc];

function _buildIdentifierLookupTableFromUnicodeRangeTable(table: unicode.UnicodeRangeTable,
        category: CharCategory, fastTableOnly: boolean) {
    for (let entryIndex = 0; entryIndex < table.length; entryIndex++) {
        const entry = table[entryIndex];
        let rangeStart: number;
        let rangeEnd: number;

        if (Array.isArray(entry)) {
            rangeStart = entry[0];
            rangeEnd = entry[1];
        } else {
            rangeStart = rangeEnd = entry;
        }

        for (let i = rangeStart; i <= rangeEnd; i++) {
            if (i < _identifierCharFastTableSize) {
                _identifierCharFastTable[i] = category;
            } else {
                _identifierCharMap[i] = category;
            }
        }

        if (fastTableOnly && rangeStart >= _identifierCharFastTableSize) {
            break;
        }
    }
}

// Build a lookup table for to speed up tokenization of identifiers.
function _buildIdentifierLookupTable(fastTableOnly: boolean) {
    _identifierCharFastTable.fill(CharCategory.NotIdentifierChar);

    _identifierCharRanges.forEach(table => {
        _buildIdentifierLookupTableFromUnicodeRangeTable(
            table, CharCategory.IdentifierChar, fastTableOnly);
    });

    _startIdentifierCharRanges.forEach(table => {
        _buildIdentifierLookupTableFromUnicodeRangeTable(
            table, CharCategory.StartIdentifierChar, fastTableOnly);
    });
}

_buildIdentifierLookupTable(true);
