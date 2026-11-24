# Personal academic website

Plain HTML/CSS/JS — no build step. Works on GitHub Pages as is.

## Put it online
1. Create a GitHub repo named **`<your-username>.github.io`** (gives you https://<your-username>.github.io).
2. Upload everything in this folder (keep `.nojekyll`).
3. Add `photo.jpg` (square, ~600×600) and `cv.pdf`.
4. Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.

## Background effect
Two options, set on the `<body>` tag in `index.html`:
- `data-effect="web"`: a soft cosmic web behind the whole page; where the cursor goes, matter flows along filaments into haloes and galaxies form.
- `data-effect="bao"`: header only, a toy galaxy field with a cursor-following BAO shell (~105 h⁻¹Mpc).

## Editing
- Everything lives in `index.html`; each section is marked with a comment.
- New paper: copy an `<li>` block in "Key papers" or "Collaboration papers".
- GitHub link: uncomment the line in the hero links.
- Colours/fonts: top of `style.css`. Light/dark mode follows the visitor's system.
