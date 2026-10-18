export interface PanelDrag {
	ref: string;
	label: string;
	local: boolean;
	repoPath: string;
}

export function dragForRepo(drag: PanelDrag | null, repoPath: string): PanelDrag | null {
	return drag && drag.repoPath === repoPath ? drag : null;
}
