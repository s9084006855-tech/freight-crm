#!/bin/bash
# bundle_tesseract.sh — Run ONCE on the developer machine before building.
# Copies Homebrew Tesseract + all dylib dependencies into src-tauri/resources/tesseract/
# End-users do NOT need Homebrew — everything is inside the .app bundle.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES="$SCRIPT_DIR/../src-tauri/resources/tesseract"
LIB_DIR="$RESOURCES/lib"
DATA_DIR="$RESOURCES/tessdata"

echo "=== Freight CRM: Bundling Tesseract ==="
echo ""

# ── 1. Homebrew check ──────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
    echo "ERROR: Homebrew not found."
    echo "Install from https://brew.sh then run: brew install tesseract"
    exit 1
fi

if ! brew list tesseract &>/dev/null; then
    echo "Installing Tesseract via Homebrew..."
    brew install tesseract
fi

TESS_PREFIX="$(brew --prefix tesseract)"
TESS_BIN="$TESS_PREFIX/bin/tesseract"
TESSDATA_SRC="$TESS_PREFIX/share/tessdata"

echo "Tesseract found: $TESS_BIN"
"$TESS_BIN" --version 2>&1 | head -1

# ── 2. Create output dirs ──────────────────────────────────────────────
mkdir -p "$LIB_DIR" "$DATA_DIR"

# ── 3. Copy binary ────────────────────────────────────────────────────
cp "$TESS_BIN" "$RESOURCES/tesseract"
chmod +x "$RESOURCES/tesseract"

# ── 4. Collect dylib dependencies recursively ─────────────────────────
collect_deps() {
    local binary="$1"
    otool -L "$binary" 2>/dev/null | tail -n +2 | awk '{print $1}' | while read -r lib; do
        # Skip system libs
        [[ "$lib" == /usr/lib/* ]] && continue
        [[ "$lib" == /System/* ]] && continue
        [[ "$lib" == @* ]] && continue
        [[ -z "$lib" ]] && continue

        local base
        base="$(basename "$lib")"
        local dest="$LIB_DIR/$base"

        if [[ -f "$lib" ]] && [[ ! -f "$dest" ]]; then
            echo "  Bundling: $base"
            cp "$lib" "$dest"
            chmod +w "$dest"
            collect_deps "$dest"
        fi
    done
}

echo ""
echo "Collecting dylib dependencies..."
collect_deps "$RESOURCES/tesseract"

# ── 5. Fix install names ──────────────────────────────────────────────
echo "Fixing library paths..."

fix_paths() {
    local file="$1"
    local is_main="$2"

    otool -L "$file" 2>/dev/null | tail -n +2 | awk '{print $1}' | while read -r lib; do
        [[ "$lib" == /usr/lib/* ]] && continue
        [[ "$lib" == /System/* ]] && continue
        [[ "$lib" == @* ]] && continue
        [[ -z "$lib" ]] && continue

        local base
        base="$(basename "$lib")"
        if [[ "$is_main" == "true" ]]; then
            install_name_tool -change "$lib" "@executable_path/lib/$base" "$file" 2>/dev/null || true
        else
            install_name_tool -change "$lib" "@loader_path/$base" "$file" 2>/dev/null || true
        fi
    done

    if [[ "$is_main" == "false" ]]; then
        local myname
        myname="$(basename "$file")"
        install_name_tool -id "@loader_path/$myname" "$file" 2>/dev/null || true
    fi
}

fix_paths "$RESOURCES/tesseract" "true"
for dylib in "$LIB_DIR"/*.dylib; do
    [[ -f "$dylib" ]] && fix_paths "$dylib" "false"
done

# ── 6. Copy language data ─────────────────────────────────────────────
echo "Copying tessdata..."
cp "$TESSDATA_SRC/eng.traineddata" "$DATA_DIR/"
[[ -f "$TESSDATA_SRC/osd.traineddata" ]] && cp "$TESSDATA_SRC/osd.traineddata" "$DATA_DIR/"

# ── 7. Create 1px white PNG for startup self-test ─────────────────────
python3 - "$RESOURCES/test_asset.png" <<'PYEOF'
import sys, struct, zlib

def white_1x1_png():
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
    ihdr_crc  = zlib.crc32(b'IHDR' + ihdr_data) & 0xFFFFFFFF
    ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)
    raw   = zlib.compress(b'\x00\xff\xff\xff')
    crc   = zlib.crc32(b'IDAT' + raw) & 0xFFFFFFFF
    idat  = struct.pack('>I', len(raw)) + b'IDAT' + raw + struct.pack('>I', crc)
    ecrc  = zlib.crc32(b'IEND') & 0xFFFFFFFF
    iend  = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', ecrc)
    return sig + ihdr + idat + iend

with open(sys.argv[1], 'wb') as f:
    f.write(white_1x1_png())
print("  Created test_asset.png")
PYEOF

# ── 8. Self-test ──────────────────────────────────────────────────────
echo ""
echo "Running self-test..."
if TESSDATA_PREFIX="$DATA_DIR" \
   DYLD_LIBRARY_PATH="$LIB_DIR" \
   "$RESOURCES/tesseract" "$RESOURCES/test_asset.png" stdout -l eng >/dev/null 2>&1; then
    echo ""
    echo "✓ Tesseract bundled and tested successfully."
    echo "  Binary : $RESOURCES/tesseract"
    echo "  Libs   : $(ls "$LIB_DIR" | wc -l | tr -d ' ') dylibs"
    echo "  Data   : $(ls "$DATA_DIR")"
else
    echo "WARNING: Self-test failed."
    echo "  Try manually: TESSDATA_PREFIX=$DATA_DIR DYLD_LIBRARY_PATH=$LIB_DIR $RESOURCES/tesseract <image> stdout"
    exit 1
fi
