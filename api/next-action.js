import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Use POST" });
  }

  const { call_id, user_message } = req.body;

  if (!call_id || !user_message) {
    return res.status(400).json({
      ok: false,
      error: "call_id and user_message are required"
    });
  }

  const { data: state, error } = await supabase
    .from("call_state")
    .select("*")
    .eq("call_id", call_id)
    .single();

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  const lower = user_message.toLowerCase();

  let intent = state.intent || "unclear";
  let next_state = state.current_state || "greeting";
  let previous_state = state.current_state;
  let reply = "No worries. How can I help today?";
  let updates = {};

  // 1. Crisis override
  if (
    lower.includes("suicide") ||
    lower.includes("kill myself") ||
    lower.includes("self harm") ||
    lower.includes("want to die")
  ) {
    intent = "possible_crisis";
    next_state = "crisis_clarification";
    reply =
      "I'm sorry, could you please repeat that? I just want to make sure I understood correctly.";
  }

  // 2. General question interruption
  else if (
    lower.includes("cost") ||
    lower.includes("price") ||
    lower.includes("fee") ||
    lower.includes("rebate")
  ) {
    intent = "general_question";
    next_state = "answer_question";
    reply =
      "Fees vary depending on the practitioner and appointment type. For new patients, the first step is usually a fifteen-minute intake call. Would you like to continue with booking?";
  }

  // 3. Start booking
  else if (
    next_state === "greeting" &&
    (lower.includes("book") ||
      lower.includes("appointment") ||
      lower.includes("see someone"))
  ) {
    intent = "book_appointment";
    next_state = "collect_patient_type";
    reply = "Of course. Have you been to the clinic before?";
  }

  // 4. Patient type
  else if (state.current_state === "collect_patient_type") {
    if (lower.includes("no") || lower.includes("new") || lower.includes("first")) {
      updates.patient_type = "new";
      next_state = "collect_preferred_time";
      reply =
        "No worries. For new patients, the first step is a fifteen-minute intake phone call with Talia. What day or time would suit you?";
    } else if (
      lower.includes("yes") ||
      lower.includes("existing") ||
      lower.includes("been before")
    ) {
      updates.patient_type = "existing";
      next_state = "collect_phone";
      reply = "No worries. Could I please grab the phone number on your file?";
    } else {
      reply = "No worries. Are you a new patient, or have you been to the clinic before?";
    }
  }

  // 5. Preferred time
  else if (state.current_state === "collect_preferred_time") {
    updates.preferred_time = user_message;
    next_state = "present_slots";
    reply =
      "Perfect, I’ll check available intake times for you. For now, let’s say I have Tuesday at 10:30 am or Wednesday at 2:00 pm. Would either of those work?";
  }

  // 6. Slot selection
  else if (state.current_state === "present_slots") {
    updates.session_start = user_message;
    next_state = "collect_first_name";
    reply = "Great. Could I please get your first name?";
  }

  // 7. First name
  else if (state.current_state === "collect_first_name") {
    updates.patient_firstname = user_message;
    next_state = "collect_last_name";
    reply = "Thanks. And your last name?";
  }

  // 8. Last name
  else if (state.current_state === "collect_last_name") {
    updates.patient_surname = user_message;
    next_state = "collect_phone";
    reply = "Thanks. Could I please get your mobile number?";
  }

  // 9. Phone
  else if (state.current_state === "collect_phone") {
    updates.patient_phone = user_message;
    next_state = "collect_dob";
    reply = "Thanks. And your date of birth? Please say it as day, month and year.";
  }

  // 10. DOB
  else if (state.current_state === "collect_dob") {
    updates.patient_dob = user_message;
    next_state = "confirm_booking";
    reply =
      "Perfect. Just to confirm, you’d like to book the intake call with Talia for the time we discussed, correct?";
  }

  // 11. Confirm
  else if (state.current_state === "confirm_booking") {
    if (lower.includes("yes") || lower.includes("correct") || lower.includes("that’s right")) {
      next_state = "booking_complete";
      reply =
        "Perfect, I’ll get that booked for you now. You’ll receive confirmation from the clinic shortly.";
    } else {
      next_state = "collect_preferred_time";
      reply = "No worries. What day or time would suit you instead?";
    }
  }

  await supabase.from("call_messages").insert([
    { call_id, role: "user", message: user_message },
    { call_id, role: "assistant", message: reply }
  ]);

  await supabase
    .from("call_state")
    .update({
      current_state: next_state,
      previous_state,
      intent,
      last_user_message: user_message,
      last_agent_message: reply,
      updated_at: new Date().toISOString(),
      ...updates
    })
    .eq("call_id", call_id);

  return res.status(200).json({
    ok: true,
    intent,
    previous_state,
    next_state,
    reply,
    updates
  });
}
