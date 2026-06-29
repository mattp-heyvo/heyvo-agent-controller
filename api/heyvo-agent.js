export default async function handler(req, res) {
  res.status(200).json({
    ok: true,
    message: "Heyvo agent controller is live",
    method: req.method
  });
}
