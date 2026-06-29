import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const { call_id, user_message } = req.body;

  const { data: state } = await supabase
    .from("call_state")
    .select("*")
    .eq("call_id", call_id)
    .single();

  return res.status(200).json({
    success: true,
    current_state: state?.current_state,
    user_message
  });
}
