# Dylan Tan portfolio

A fast, dependency-free portfolio site.

- **Edit content:** sign in at https://app.pagescms.org with GitHub and open this repository. Projects, images and the About text are all editable there.
- **Hosting:** Cloudflare Pages rebuilds the site automatically every time something changes here.
  - Build command: `node build.js`
  - Build output directory: `dist`
- **Run locally (optional):** `node build.js`, then open `dist/index.html` through any local web server.

## Where things live

| What | Where |
| --- | --- |
| Projects (one file each) | `src/projects/*.json` |
| Name, tagline, About, contact | `src/site.json` |
| Images | `src/images/` |
| Design (colors, type, layout) | `src/assets/style.css` |
| Animations and interactions | `src/assets/site.js` |
| Page templates | `build.js` |
