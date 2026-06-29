import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const callId = req.query.call_id || "test-call-001";

  const { data, error } = await supabase
    .from("call_state")
    .upsert(
      {
        call_id: callId,
        current_state: "greeting",
        intent: "test",
        last_user_message: "Testing Heyvo controller",
        updated_at: new Date().toISOString()
      },
      { onConflict: "call_id" }
    )
    .select();

  if (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }

  res.status(200).json({
    ok: true,
    message: "Supabase connected and call_state updated",
    data
  });
}
