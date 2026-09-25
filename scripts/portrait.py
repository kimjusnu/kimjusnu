"""GitHub 프로필 사진을 글자 초상으로 바꿔 터미널 타이핑 SVG로 그린다.

사용: python scripts/portrait.py [로그인]   → assets/portrait.svg
"""
import io
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

LOGIN = sys.argv[1] if len(sys.argv) > 1 else "kimjusnu"
OUT = Path("assets/portrait.svg")
RAMP = " `:-=+*cs#%@"  # 어두움 → 밝음 (어두운 터미널에서 밝은 곳을 촘촘한 글자로)
COLS, ROWS = 65, 37  # 560×640 카드. 오른쪽 daytime 차트와 크기를 맞춘다
CHAR_W, LINE_H = 8.0, 15.0  # 글자 한 칸의 폭과 줄 높이. 비율이 곧 세로 압축률이다
PAD, TOP = 20, 37.0
STEP = 0.11  # 한 줄이 타이핑되는 시간(초)


def fetch_avatar(login: str) -> Image.Image:
    with urllib.request.urlopen(f"https://github.com/{login}.png?size=460", timeout=30) as res:
        return Image.open(io.BytesIO(res.read())).convert("L")


def to_lines(img: Image.Image) -> list[str]:
    # 얼굴 쪽으로 잘라 글자 칸 비율(가로 65×8 : 세로 37×15)에 맞춘다
    aspect = COLS * CHAR_W / (ROWS * LINE_H)
    w, h = img.size
    ch = h * 0.88
    cw = min(w, ch * aspect)
    left = (w - cw) / 2
    img = img.crop((int(left), int(h * 0.02), int(left + cw), int(h * 0.02 + ch)))
    # 배경이 복잡한 그림이라 평활화로 명암 차이를 벌려야 윤곽이 산다
    img = ImageOps.equalize(img).resize((COLS, ROWS), Image.LANCZOS)
    px = img.load()
    last = len(RAMP) - 1
    return ["".join(RAMP[px[x, y] * last // 255] for x in range(COLS)) for y in range(ROWS)]


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def svg(lines: list[str], login: str) -> str:
    width = PAD * 2 + COLS * CHAR_W
    body_h = TOP + len(lines) * LINE_H
    height = body_h + 43
    text_w = COLS * CHAR_W
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height:.0f}" viewBox="0 0 {width:.0f} {height:.0f}" '
        'font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" role="img" aria-label="ASCII portrait">',
        '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111722"/>'
        '<stop offset="1" stop-color="#0d1117"/></linearGradient></defs>',
        f'<rect width="{width:.0f}" height="{height:.0f}" rx="12" fill="url(#bg)"/>',
        f'<rect x="0.5" y="0.5" width="{width - 1:.0f}" height="{height - 1:.0f}" rx="12" fill="none" stroke="#30363d"/>',
        f'<line x1="0" y1="30" x2="{width:.0f}" y2="30" stroke="#30363d"/>',
        '<circle cx="20" cy="15" r="5" fill="#ff5f56"/><circle cx="36" cy="15" r="5" fill="#ffbd2e"/><circle cx="52" cy="15" r="5" fill="#27c93f"/>',
        f'<text x="{width / 2:.0f}" y="19" fill="#7d8590" font-size="12" text-anchor="middle">{esc(login)}@github: ~$ ./portrait.sh</text>',
    ]
    for i, line in enumerate(lines):
        y = TOP + i * LINE_H
        begin = i * STEP
        dur = begin + STEP
        k = begin / dur
        # 지연을 keyTimes에 넣어, 애니메이션이 안 도는 환경에서도 줄이 보이게 한다
        out.append(
            f'<clipPath id="r{i}"><rect x="{PAD}" y="{y:.1f}" height="{LINE_H:.0f}" width="{text_w:.0f}">'
            f'<animate attributeName="width" values="0;0;{text_w:.0f}" keyTimes="0;{k:.3f};1" dur="{dur:.3f}s" fill="freeze"/></rect></clipPath>'
            f'<g clip-path="url(#r{i})"><text xml:space="preserve" x="{PAD}" y="{y + 11.1:.1f}" fill="#c9d1d9" font-size="12.9" '
            f'textLength="{text_w:.0f}" lengthAdjust="spacing">{esc(line)}</text></g>'
        )
    prompt = f"{login}@github:~$ whoami "
    out.append(f'<line x1="0" y1="{body_h:.1f}" x2="{width:.0f}" y2="{body_h:.1f}" stroke="#30363d"/>')
    out.append(f'<text x="{PAD}" y="{body_h + 19:.1f}" fill="#7d8590" font-size="13">{esc(prompt)}<tspan fill="#c9d1d9">{esc(login)}</tspan></text>')
    cursor_x = PAD + (len(prompt) + len(login)) * 7.83 + 4
    out.append(
        f'<rect x="{cursor_x:.0f}" y="{body_h + 7:.1f}" width="8" height="14" fill="#c9d1d9">'
        '<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.51;1" dur="1s" repeatCount="indefinite"/></rect>'
    )
    out.append("</svg>")
    return "".join(out)


def main() -> None:
    lines = to_lines(fetch_avatar(LOGIN))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(svg(lines, LOGIN), encoding="utf-8")
    print(f"글자 초상 {len(lines)}줄 × {COLS}칸 생성 완료")


if __name__ == "__main__":
    main()
