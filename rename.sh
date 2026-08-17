#!/bin/bash
TARGET_DIR="${1:-.}" # 引数がなければカレントディレクトリを対象にする
i=1

for file in "$TARGET_DIR"/*; do
  if [ -f "$file" ]; then
    ext="${file##*.}"
    dir=$(dirname "$file")
    new_name=$(printf "%04d.%s" "$i" "$ext")
    mv "$file" "$dir/$new_name"
    ((i++))
  fi
done