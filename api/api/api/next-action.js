import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Use POST"
    });
  }

  const { call_id, user_message } = req.body;

  if (!call_id || !user_message) {
    return res.status(400).json({
      ok: false,
      error: "call_id and user_message are required"
    });
  }

  const { data: state, error: stateError } = await supabase
    .from("call_state")
    .select("*")
    .eq("call_id", call_id)
    .single();

  if (stateError) {
    return res.status(500).json({
      ok: false,
      error: stateError.message
    });
  }

  const lower = user_message.toLowerCase();

  let intent = "unclear";
  let next_state = state.current_state || "greeting";
  let reply = "No worries. How can I help today?";

  if (
    lower.includes("suicide") ||
    lower.includes("kill myself") ||
    lower.includes("self harm") ||
    lower.includes("want to die")
  ) {
    intent = "possible_crisis";
    next_state = "crisis_clarification";
    reply = "I'm sorry, could you please repeat that? I just want to make sure I understood correctly.";
  } else if (
    lower.includes("book") ||
    lower.includes("appointment") ||
    lower.includes("see someone")
  ) {
    intent = "book_appointment";
    next_state = "collect_patient_type";
    reply = "Of course. Have you been to the clinic before?";
  } else if (
    lower.includes("cost") ||
    lower.includes("price") ||
    lower.includes("fee") ||
    lower.includes("rebate")
  ) {
    intent = "general_question";
    next_state = "answer_question";
    reply = "Fees vary depending on the practitioner and appointment type. Would you like me to continue with your booking?";
  }

  await supabase
    .from("call_messages")
    .insert([
      {
        call_id,
        role: "user",
        message: user_message
      },
      {
        call_id,
        role: "assistant",
        message: reply
      }
    ]);

  await supabase
    .from("call_state")
    .update({
      current_state: next_state,
      previous_state: state.current_state,
      intent,
      last_user_message: user_message,
      last_agent_message: reply,
      updated_at: new Date().toISOString()
    })
    .eq("call_id", call_id);

  return res.status(200).json({
    ok: true,
    intent,
    previous_state: state.current_state,
    next_state,
    reply
  });
}
