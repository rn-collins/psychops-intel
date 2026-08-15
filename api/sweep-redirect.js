export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Location", "/");
  res.status(303).end();
}
