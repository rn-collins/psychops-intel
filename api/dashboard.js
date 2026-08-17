export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = 308;
  res.setHeader("Location", "/");
  res.end();
}
