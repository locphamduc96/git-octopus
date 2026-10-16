#!/bin/sh
# Dựng repo `review` cho smoke 0.22.0 (071 · 072 · 080–101): mỗi nhánh / file phục vụ một mục của
# checklist (workspace project-notes/06-reviews/smoke-gop-23-feature-2026-10-14.md) và của test E2E.
#   sh review-repo.sh <ROOT>  →  <ROOT>/review, <ROOT>/review-origin.git, <ROOT>/review-wt
# Dùng chung: test E2E (packages/e2e) và setup-playground.sh của workspace.
set -e

ROOT="$1"
[ -n "$ROOT" ] || { echo "usage: review-repo.sh <ROOT>" >&2; exit 2; }
mkdir -p "$ROOT"
export GIT_MERGE_AUTOEDIT=no
# The fixture's LFS files are bare pointers with no object behind them: never try to download one.
export GIT_LFS_SKIP_SMUDGE=1

mkgit() {
	git init -q --initial-branch=main "$1"
	git -C "$1" config user.name "Test"
	git -C "$1" config user.email "test@example.invalid"
	git -C "$1" config commit.gpgsign false
}

git init -q --bare "$ROOT/review-origin.git"
mkgit "$ROOT/review"
cd "$ROOT/review"
git remote add origin "$ROOT/review-origin.git"

rcommit() {
	# $1 = file, $2 = message — file đã được ghi sẵn, chỉ add + commit
	git add -A
	git commit -qm "$2"
}

board_lines() {
	# $1 = combo reset (0/1) — file đủ dài để hai chỗ sửa thành hai hunk riêng
	echo "export const score = { value: 0 };"
	echo "export const combo = { value: 0 };"
	for i in $(seq 1 14); do echo "export const lane$i = { notes: [], hits: 0, misses: 0 };"; done
	echo "export function hit(lane: number) { score.value += 100; combo.value += 1; }"
	if [ "$1" = 1 ]; then echo "export function miss() { combo.value = 0; }"; else echo "export function miss() {}"; fi
	for i in $(seq 1 10); do echo "export const tier$i = $i * 1000;"; done
}

# 088: lịch sử qua đổi tên + blame nhiều commit
mkdir -p src
printf '# Rhythm review\n\nTitle line kept for the conflict test.\n' > README.md
printf '*.bin filter=lfs diff=lfs merge=lfs -text\n' > .gitattributes
printf 'export const SPEED = 1;\nexport const LANES = 4;\n' > src/constants.ts
board_lines 0 > src/scoreboard.ts
printf 'export function pad(n: number) {\n  return String(n).padStart(6, "0");\n}\n' > src/format.ts
rcommit . "feat: scoreboard"
echo "export const COMBO_CAP = 99;" >> src/scoreboard.ts
rcommit . "feat: combo counter"
git mv src/scoreboard.ts src/board.ts
rcommit . "refactor: rename scoreboard to board"
board_lines 1 > src/board.ts
echo "export const COMBO_CAP = 99;" >> src/board.ts
rcommit . "fix: reset combo on miss"
# 087: file để Restore File from this Commit
printf 'export const SPEED = 2.5;\nexport const LANES = 4;\n' > src/constants.ts
rcommit . "tune: faster notes"
# 072: commit lớn cho cột Changes
mkdir -p data
for i in $(seq 1 1500); do echo "{ \"level\": $i, \"bpm\": $((90 + i % 80)) }"; done > data/levels.jsonl
rcommit . "chore: import level data"

# 082 · 083 · 095: develop có trên origin
git checkout -q -b develop
echo "perf" > perf.txt && rcommit . "perf: cache the lane layout"
echo "docs" > docs.txt && rcommit . "docs: explain scoring"
git checkout -q main

# 082: nhánh ồn để Hide
git checkout -q -b noisy/experiment main~2
for i in 1 2 3; do echo "spike $i" >> spike.txt; rcommit . "spike: canvas try $i"; done

# 101: bốn commit độc lập để cherry-pick
git checkout -q -b feature/picks main~3
for n in one two three four; do echo "$n" > "pick-$n.txt"; rcommit . "feat: pick $n"; done

# 100: nhánh để kéo thả lên main rồi interactive rebase
git checkout -q -b feature/rebase-me main~3
for i in 1 2 3; do echo "step $i" > "rebase-me-$i.txt"; rcommit . "rebase-me: step $i"; done

# 089 · 092: nhánh có commit nháp để dọn bằng interactive rebase
git checkout -q -b feature/tidy main
echo "real" > tidy.txt && rcommit . "feat: tidy the hud"
echo "oops" >> tidy.txt && rcommit . "fixup typo"
echo "wip" > wip.txt && rcommit . "wip"
echo "more" >> tidy.txt && rcommit . "feat: tidy the menu"

# 105: ảnh đổi giữa hai commit (PNG 1×1 đỏ rồi xanh) — nhánh riêng, không xê dịch main
git checkout -q -b feature/art main
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 --decode > logo.png
rcommit . "art: add the logo"
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' | base64 --decode > logo.png
rcommit . "art: recolour the logo"
# 111: một file LFS (chỉ pointer) đổi bản
lfs_pointer() { printf 'version https://git-lfs.github.com/spec/v1\noid sha256:%s\nsize %s\n' "$1" "$2"; }
lfs_pointer "$(printf 'a%.0s' $(seq 1 64))" 1048576 > music.bin
rcommit . "art: add the music"
lfs_pointer "$(printf 'b%.0s' $(seq 1 64))" 2621440 > music.bin
rcommit . "art: new mix"

# 094: nhánh local để kéo thả push / reset
git checkout -q -b feature/push-me main
echo "push me" > push-me.txt && rcommit . "feat: push me"
git branch -q scratch main~4

# 080 · 097: merge commit
git checkout -q -b feature/merged main
mkdir -p merged
echo a > merged/a.txt && rcommit . "feat(merged): part a"
echo b > merged/b.txt && rcommit . "feat(merged): part b"
git checkout -q main
git merge -q --no-ff -m "Merge branch 'feature/merged'" feature/merged

# 090: conflict ở README dòng 3
git checkout -q -b conflict/incoming main
sed -i.bak '3s/.*/Title line from the incoming branch./' README.md && rm -f README.md.bak
rcommit . "docs: title from incoming"
git checkout -q main
sed -i.bak '3s/.*/Title line from main./' README.md && rm -f README.md.bak
rcommit . "docs: title from main"

# Lên origin: main, develop, release (release chỉ có trên remote — 094)
git push -q -u origin main develop
git push -q origin main~2:refs/heads/release
git fetch -q origin

# 096: một worktree giữ nhánh, một worktree mất thư mục (để Prune)
git worktree add -q -b wt/elsewhere "$ROOT/review-wt" main~1
git worktree add -q -b wt/gone "$ROOT/review-gone" main~1
rm -rf "$ROOT/review-gone"

# 093: commit.template + hook chặn message có chữ "chan-hook" (Skip hooks phải vượt qua được)
printf 'feat: \n\n# Why:\n' > .git/commit-template.txt
git config commit.template .git/commit-template.txt
printf '#!/bin/sh\nif grep -q chan-hook "$1"; then echo "commit-msg hook cua playground: chan" >&2; exit 1; fi\n' > .git/hooks/commit-msg
chmod +x .git/hooks/commit-msg

# 085 · 086 · 091 · 097: thay đổi chưa commit
sed -i.bak -e '2s/.*/export const combo = { value: 0, best: 0 };/' \
	-e '28s/.*/export const tier10 = 10 * 1000; \/\/ this line is deliberately long so that wrap has something to fold: lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor/' src/board.ts && rm -f src/board.ts.bak
printf 'export function pad(n: number) {\n    return String(n).padStart(6, "0");\n}\n' > src/format.ts
mkdir -p notes && echo "- try a 7-lane chart" > notes/todo.md
