import os
import sys
import subprocess
from pathlib import Path

def generate_icons(source_image_path):
    if not os.path.exists(source_image_path):
        print(f"Error: Source image not found at {source_image_path}")
        sys.exit(1)

    project_root = Path(__file__).parent.parent
    static_favicon_dir = project_root / "static" / "favicon"
    
    # Ensure output directory exists
    static_favicon_dir.mkdir(parents=True, exist_ok=True)

    icons = [
        # Android / PWA
        ("android-icon-36x36.png", 36),
        ("android-icon-48x48.png", 48),
        ("android-icon-72x72.png", 72),
        ("android-icon-96x96.png", 96),
        ("android-icon-144x144.png", 144),
        ("android-icon-192x192.png", 192),
        
        # Apple
        ("apple-icon-57x57.png", 57),
        ("apple-icon-60x60.png", 60),
        ("apple-icon-72x72.png", 72),
        ("apple-icon-76x76.png", 76),
        ("apple-icon-114x114.png", 114),
        ("apple-icon-120x120.png", 120),
        ("apple-icon-144x144.png", 144),
        ("apple-icon-152x152.png", 152),
        ("apple-icon-180x180.png", 180),
        ("apple-icon.png", 192), # standard fallback
        ("apple-icon-precomposed.png", 192), # standard fallback

        # Microsoft
        ("ms-icon-70x70.png", 70),
        ("ms-icon-144x144.png", 144),
        ("ms-icon-150x150.png", 150),
        ("ms-icon-310x310.png", 310),

        # Standard Favicons
        ("favicon-16x16.png", 16),
        ("favicon-32x32.png", 32),
        ("favicon-96x96.png", 96),
    ]

    print(f"Generating icons from {source_image_path}...")

    for filename, size in icons:
        output_path = static_favicon_dir / filename
        cmd = [
            "convert",
            source_image_path,
            "-resize", f"{size}x{size}",
            str(output_path)
        ]
        try:
            subprocess.run(cmd, check=True)
            print(f"Generated {filename}")
        except subprocess.CalledProcessError as e:
            print(f"Error generating {filename}: {e}")
            sys.exit(1)

    # Generate favicon.ico (combining 16, 32, 48)
    # First generate temp 48x48 if not already there or just use memory
    # To acturally make a proper ICO we'll generate 48x48 png first
    
    temp_48 = static_favicon_dir / "temp_48.png"
    subprocess.run(["convert", source_image_path, "-resize", "48x48", str(temp_48)], check=True)
    
    favicon_ico_path = static_favicon_dir / "favicon.ico"
    cmd_ico = [
        "convert",
        str(static_favicon_dir / "favicon-16x16.png"),
        str(static_favicon_dir / "favicon-32x32.png"),
        str(temp_48),
        str(favicon_ico_path)
    ]
    try:
        subprocess.run(cmd_ico, check=True)
        print("Generated favicon.ico")
    except subprocess.CalledProcessError as e:
            print(f"Error generating favicon.ico: {e}")
    finally:
        if os.path.exists(temp_48):
            os.remove(temp_48)

    print("All icons generated successfully.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python generate_icons.py <path_to_source_image>")
        sys.exit(1)
    
    source_image = sys.argv[1]
    generate_icons(source_image)
