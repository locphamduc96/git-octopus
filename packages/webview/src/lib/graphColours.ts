/** Graph lane colours. Index cycles; must be at least GRAPH_COLOUR_COUNT long. */
const listPalette = [
	'#0085d9',
	'#d9008f',
	'#00d90a',
	'#d98500',
	'#a300d9',
	'#ff5252',
	'#00d9cc',
	'#e138e8',
	'#85d900',
	'#6f8cff',
];

export function graphColour(index: number): string {
	return listPalette[index % listPalette.length];
}
