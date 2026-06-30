import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CRISIS_TERMS = [
  "suicide",
  "kill myself",
  "want to die",
  "self harm",
  "self-harm",
  "hurt myself",
  "can't go on",
  "cant go on"
];

const PRICE_TERMS = ["cost", "price", "fee", "fees", "rebate", "medicare"];
const BOOKING_TERMS = ["book", "appointment", "see someone", "intake"];

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function isYes(text) {
  return ["yes", "yeah", "yep", "correct", "that's right", "that is right", "ok", "okay"].some((term) =>
    text.includes(term)
  );
}

function isNo(text) {
  return ["no", "nope", "not really", "new", "first time", "haven't", "have not"].some((term) =>
    text.includes(term)
  );
}

function extractNamePart(message) {
  return message.trim();
}

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

  const { data: existingState, error: fetchError } = await supabase
    .from("call_state")
    .select("*")
    .eq("call_id", call_id)
    .single();

  if (fetchError) {
    return res.status(500).json({
      ok: false,
      error: fetchError.message
    });
  }

  const state = existingState || {};
  const lower = user_message.toLowerCase();

  let intent = state.intent || "unclear";
  let previous_state = state.current_state || "greeting";
  let next_state = previous_state;
  let reply = "No worries. How can I help today?";
  let updates = {};

  if (includesAny(lower, CRISIS_TERMS)) {
    intent = "possible_crisis";
    next_state = "crisis_clarification";
    updates.risk_level = "possible_crisis";
    reply =
      "I'm sorry, could you please repeat that? I just want to make sure I understood correctly.";
  } else if (state.current_state === "crisis_clarification") {
    if (includesAny(lower, CRISIS_TERMS) || lower.includes("yes")) {
      intent = "confirmed_crisis";
      next_state = "crisis_confirmed";
      updates.risk_level = "high";
      reply =
        "I'm really sorry you're feeling this way. I'm not equipped to provide crisis support, but if you're in immediate danger please call 000. You can also contact Lifeline on 13 11 14 for immediate support. Would you like me to arrange for someone from the clinic to call you back as soon as possible?";
    } else {
      intent = state.intent || "unclear";
      next_state = state.previous_state || "greeting";
      updates.risk_level = "normal";
      reply = "Thanks for clarifying. No worries — how can I help from here?";
    }
  } else if (includesAny(lower, PRICE_TERMS)) {
    intent = "general_question";
    next_state = "answer_question";
    reply =
      "Fees vary depending on the practitioner and appointment type. For new patients, the first step is usually a fifteen-minute intake call with Talia. Would you like to continue with your booking?";
  } else if (state.current_state === "answer_question") {
    if (isYes(lower)) {
      intent = state.intent || "book_appointment";
      next_state = state.previous_state || "collect_patient_type";
      reply = "No worries, let's continue. Have you been to the clinic before?";
    } else {
      next_state = "close";
      reply = "No worries at all. Is there anything else I can help with?";
    }
  } else if (
    (state.current_state === "greeting" || !state.current_state) &&
    includesAny(lower, BOOKING_TERMS)
  ) {
    intent = "book_appointment";
    next_state = "collect_patient_type";
    reply = "Of course. Have you been to the clinic before?";
  } else if (state.current_state === "collect_patient_type") {
    if (isNo(lower)) {
      intent = "book_appointment";
      updates.patient_type = "new";
      next_state = "new_collect_preferred_time";
      reply =
        "No worries. For new patients, the first step is a fifteen-minute intake phone call with Talia. What day or time would suit you?";
    } else if (isYes(lower) || lower.includes("existing") || lower.includes("been before")) {
      intent = "existing_patient_booking";
      updates.patient_type = "existing";
      next_state = "existing_collect_phone";
      reply = "No worries. Could I please grab the phone number on your file?";
    } else {
      reply = "No worries. Are you a new patient, or have you been to the clinic before?";
    }
  } else if (state.current_state === "new_collect_preferred_time") {
    updates.preferred_time = user_message;
    next_state = "new_present_slots";
    reply =
      "Perfect, I’ll check available intake times for you. For now, let’s say I have Tuesday at 10:30 am or Wednesday at 2:00 pm. Would either of those work?";
  } else if (state.current_state === "new_present_slots") {
    updates.selected_slot = user_message;
    updates.practitioner_name = "Talia";
    updates.practitioner_role_id = "PR-2021211";
    next_state = "new_collect_first_name";
    reply = "Great. Could I please get your first name?";
  } else if (state.current_state === "new_collect_first_name") {
    updates.patient_firstname = extractNamePart(user_message);
    next_state = "new_collect_last_name";
    reply = "Thanks. And your last name?";
  } else if (state.current_state === "new_collect_last_name") {
    updates.patient_surname = extractNamePart(user_message);
    next_state = "new_collect_phone";
    reply = "Thanks. Could I please get your mobile number?";
  } else if (state.current_state === "new_collect_phone") {
    updates.patient_phone = user_message;
    next_state = "new_collect_dob";
    reply = "Thanks. And your date of birth? Please say it as day, month and year.";
  } else if (state.current_state === "new_collect_dob") {
    updates.patient_dob = user_message;
    next_state = "new_confirm_booking";
    reply =
      "Perfect. Just to confirm, you’d like to book the intake call with Talia for the time we discussed, correct?";
  } else if (state.current_state === "new_confirm_booking") {
    if (isYes(lower)) {
      next_state = "new_create_patient";
      reply =
        "Perfect, I have everything I need. The next step is to create the patient record and book the appointment.";
    } else {
      next_state = "new_collect_preferred_time";
      reply = "No worries. What day or time would suit you instead?";
    }
  } else if (state.current_state === "existing_collect_phone") {
    updates.patient_phone = user_message;
    next_state = "existing_check_patient";
    reply =
      "Thanks. The next step is to check the patient record and then look for available appointments.";
  } else {
    reply =
      "No worries. I just want to make sure I’m helping properly — are you looking to book, reschedule, cancel, or ask a general question?";
    next_state = "clarify_intent";
  }

  await supabase.from("call_messages").insert([
    { call_id, role: "user", message: user_message },
    { call_id, role: "assistant", message: reply }
  ]);

  const { error: updateError } = await supabase
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

  if (updateError) {
    return res.status(500).json({
      ok: false,
      error: updateError.message
    });
  }

  return res.status(200).json({
    ok: true,
    intent,
    previous_state,
    next_state,
    reply,
    updates
  });
}
