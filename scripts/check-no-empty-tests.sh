#!/usr/bin/env bash
# check-no-empty-tests.sh
#
# Fails if any package with source files has zero test files.
# Runs in CI to prevent shipping untested packages.

set -euo pipefail

exit_code=0
dirs=()

# Packages excluded from the test requirement (scaffolding tools, etc.)
EXCLUDED="create-switchboard-cartridge"

# Collect all package directories
for base in packages cartridges apps; do
  if [ -d "$base" ]; then
    for pkg in "$base"/*/; do
      pkg_name=$(basename "$pkg")
      if [ -d "${pkg}src" ] && [[ ! " $EXCLUDED " =~ " $pkg_name " ]]; then
        dirs+=("$pkg")
      fi
    done
  fi
done

echo "Checking test coverage for ${#dirs[@]} packages..."
echo ""

for pkg in "${dirs[@]}"; do
  # Count non-test source files
  src_count=$(find "${pkg}src" -name "*.ts" \
    ! -name "*.test.ts" \
    ! -name "*.spec.ts" \
    ! -name "*.d.ts" \
    ! -path "*/node_modules/*" \
    ! -path "*/dist/*" \
    2>/dev/null | wc -l | tr -d ' ')

  # Count test files
  test_count=$(find "${pkg}src" -name "*.test.ts" -o -name "*.spec.ts" \
    2>/dev/null | wc -l | tr -d ' ')

  if [ "$src_count" -gt 0 ] && [ "$test_count" -eq 0 ]; then
    echo "FAIL: ${pkg} has ${src_count} source files but 0 test files"
    exit_code=1
  fi
done

if [ "$exit_code" -eq 0 ]; then
  echo "OK: All packages with source files have at least one test file."
fi

exit $exit_code
