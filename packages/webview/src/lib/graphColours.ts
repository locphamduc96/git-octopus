/**
 * Graph lane colours. Index cycles; must be at least GRAPH_COLOUR_COUNT long.
 *
 * Every hue is the same one it always was, taken down to 80% brightness: at full strength ten
 * saturated lines shout over the commit subjects they sit beside, which are what the eye is
 * actually reading.
 */
const listPalette = [
	'#006aae',
	'#ae0072',
	'#00ae08',
	'#ae6a00',
	'#8200ae',
	'#cc4242',
	'#00aea3',
	'#b42dba',
	'#6aae00',
	'#5970cc',
];

export function graphColour(index: number): string {
	return listPalette[index % listPalette.length];
}
