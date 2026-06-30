import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CRISIS_TERMS = [
  "suicide", "kill myself", "want to die", "self harm", "self-harm",
  "hurt myself", "can't go on", "cant go on"
];

const BOOKING_TERMS = [
  "book", "booking", "appointment", "see someone", "intake",
  "skin check", "consultation", "initial skin consult", "full body skin check"
];

const QUESTION_STARTERS = [
  "who", "what", "where", "when", "why", "how",
  "can", "could", "do", "does", "is", "are", "will",
  "would", "should"
];

const SIDE_COMMENT_TERMS = [
  "actually", "before that", "by the way", "also", "quick question",
  "one thing", "hang on", "wait", "sorry"
];

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function isYes(text) {
  const normalized = text.toLowerCase().trim();
  return ["yes", "yeah", "yep", "correct", "that's right", "that is right", "ok", "okay"].includes(normalized);
}

function isNo(text) {
  const normalized = text.toLowerCase().trim();
  return [
    "no", "nope", "not really", "new", "first time",
    "i am new", "i'm new", "new patient",
    "i am a new patient", "i'm a new patient",
    "haven't", "have not", "i haven't been before", "i have not been before"
  ].some((term) => normalized === term || normalized.includes(term));
}

function getLatestUserMessageFromTranscript(transcript = "") {
  const matches = transcript.match(/User:\s*(.*)/g);
  if (!matches || matches.length === 0) return "";
  return matches[matches.length - 1].replace("User:", "").trim();
}

function extractRetellPayload(body) {
  const call_id =
    body?.call_id ||
    body?.call?.call_id ||
    body?.call?.id ||
    body?.callId ||
    body?.metadata?.call_id ||
    `retell-${Date.now()}`;

  const transcript =
    body?.call?.transcript ||
    body?.transcript ||
    "";

  const user_message =
    body?.user_message ||
    body?.args?.user_message ||
    body?.arguments?.user_message ||
    body?.input?.user_message ||
    body?.message ||
    body?.latest_transcript ||
    body?.last_user_message ||
    getLatestUserMessageFromTranscript(transcript);

  return { call_id, user_message };
}

function isMidFlow(stateName) {
  return !["greeting", "close", "crisis_clarification", "crisis_confirmed", "answer_question"].includes(stateName);
}

function isGenericInterruption(text, currentState) {
  const normalized = text.toLowerCase().trim();
  if (!isMidFlow(currentState)) return false;

  const startsWithQuestion = QUESTION_STARTERS.some((word) =>
    normalized.startsWith(word + " ")
  );

  return (
    text.includes("?") ||
    startsWithQuestion ||
    includesAny(normalized, SIDE_COMMENT_TERMS)
  );
}

function answerGeneralQuestion(text) {
  const lower = text.toLowerCase();

  if (lower.includes("cost") || lower.includes("price") || lower.includes("fee") || lower.includes("rebate") || lower.includes("medicare")) {
    return "Fees vary depending on the appointment type. Would you like to continue with your booking?";
  }

  if (lower.includes("telehealth") || lower.includes("online") || lower.includes("video")) {
    return "Some appointments may be available by telehealth, depending on the service. Would you like to continue with your booking?";
  }

  if (lower.includes("hour") || lower.includes("open") || lower.includes("time")) {
    return "Clinic hours can vary by day. Reception can confirm the finer details if needed. Would you like to continue with your booking?";
  }

  if (lower.includes("where") || lower.includes("location") || lower.includes("based") || lower.includes("address")) {
    return "The clinic is based in Invercargill. Reception can help with the exact location details if needed. Would you like to continue with your booking?";
  }

  return "Good question. Reception can help with the finer details if needed, but I can keep helping you here. Would you like to continue with your booking?";
}

function promptForState(stateName) {
  const prompts = {
    collect_patient_type: "No worries, let's continue. Have you been to the clinic before?",
    new_collect_preferred_time: "No worries, let's continue. What day or time would suit you?",
    new_present_slots: "No worries, let's continue. Would Tuesday at 10:30 am or Wednesday at 2:00 pm work?",
    new_collect_first_name: "No worries, let's continue. Could I please get your first name?",
    new_collect_last_name: "No worries, let's continue. And your last name?",
    new_collect_phone: "No worries, let's continue. Could I please get your mobile number?",
    new_confirm_booking: "No worries, let's continue. Just to confirm, you’d like to book that appointment, correct?",
    existing_collect_phone: "No worries, let's continue. Could I please grab the phone number on your file?"
  };

  return prompts[stateName] || "No worries, let's continue. How can I help from here?";
}

async function getOrCreateCallState(call_id) {
  const { data, error } = await supabase
    .from("call_state")
    .select("*")
    .eq("call_id", call_id)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  const { data: newState, error: insertError } = await supabase
    .from("call_state")
    .insert({
      call_id,
      current_state: "greeting",
      intent: "unclear",
      risk_level: "normal",
      updated_at: new Date().toISOString()
    })
    .select("*")
    .single();

  if (insertError) throw insertError;
  return newState;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Use POST" });
  }

  const { call_id, user_message } = extractRetellPayload(req.body || {});

  if (!user_message) {
    return res.status(200).json({
      ok: true,
      call_id,
      intent: "listening",
      next_state: "listening",
      reply: "Of course — go on, I'm listening."
    });
  }

  let state;

  try {
    state = await getOrCreateCallState(call_id);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

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
    updates.resume_state = state.current_state || "greeting";
    reply = "I'm sorry, could you please repeat that? I just want to make sure I understood correctly.";
  }

  else if (state.current_state === "crisis_clarification") {
    if (includesAny(lower, CRISIS_TERMS) || isYes(lower)) {
      intent = "confirmed_crisis";
      next_state = "crisis_confirmed";
      updates.risk_level = "high";
      reply = "I'm really sorry you're feeling this way. I'm not equipped to provide crisis support, but if you're in immediate danger please call 000. You can also contact Lifeline on 13 11 14 for immediate support. Would you like me to arrange for someone from the clinic to call you back as soon as possible?";
    } else {
      next_state = state.resume_state || state.previous_state || "greeting";
      updates.risk_level = "normal";
      updates.resume_state = null;
      reply = promptForState(next_state);
    }
  }

  else if (isGenericInterruption(user_message, state.current_state)) {
    intent = "general_question";
    next_state = "answer_question";
    updates.resume_state = state.current_state;
    reply = answerGeneralQuestion(user_message);
  }

  else if (state.current_state === "answer_question") {
    if (isYes(lower)) {
      next_state = state.resume_state || state.previous_state || "collect_patient_type";
      updates.resume_state = null;
      reply = promptForState(next_state);
    } else {
      next_state = "close";
      updates.resume_state = null;
      reply = "No worries at all. Is there anything else I can help with?";
    }
  }

  else if (
    (state.current_state === "greeting" || !state.current_state) &&
    includesAny(lower, BOOKING_TERMS)
  ) {
    intent = "book_appointment";
    next_state = "collect_patient_type";
    reply = "Of course. Have you been to the clinic before?";
  }

  else if (state.current_state === "collect_patient_type") {
    if (isNo(lower)) {
      intent = "book_appointment";
      updates.patient_type = "new";
      next_state = "new_collect_preferred_time";
      reply = "No worries. What day or time would suit you?";
    } else if (isYes(lower) || lower.includes("existing") || lower.includes("been before")) {
      intent = "existing_patient_booking";
      updates.patient_type = "existing";
      next_state = "existing_collect_phone";
      reply = "No worries. Could I please grab the phone number on your file?";
    } else {
      reply = "No worries. Have you been to the clinic before?";
    }
  }

  else if (state.current_state === "new_collect_preferred_time") {
    updates.preferred_time = user_message;
    next_state = "new_present_slots";
    reply = "Perfect, I’ll check available times for you. For now, let’s say I have Tuesday at 10:30 am or Wednesday at 2:00 pm. Would either of those work?";
  }

  else if (state.current_state === "new_present_slots") {
    updates.selected_slot = user_message;
    next_state = "new_collect_first_name";
    reply = "Great. Could I please get your first name?";
  }

  else if (state.current_state === "new_collect_first_name") {
    updates.patient_firstname = user_message.trim();
    next_state = "new_collect_last_name";
    reply = "Thanks. And your last name?";
  }

  else if (state.current_state === "new_collect_last_name") {
    updates.patient_surname = user_message.trim();
    next_state = "new_collect_phone";
    reply = "Thanks. Could I please get your mobile number?";
  }

  else if (state.current_state === "new_collect_phone") {
    updates.patient_phone = user_message;
    next_state = "new_confirm_booking";
    reply = "Perfect. Just to confirm, you’d like to book that appointment, correct?";
  }

  else if (state.current_state === "new_confirm_booking") {
    if (isYes(lower)) {
      next_state = "new_create_patient";
      reply = "Perfect, I have everything I need. The next step is to create the patient record and book the appointment.";
    } else {
      next_state = "new_collect_preferred_time";
      reply = "No worries. What day or time would suit you instead?";
    }
  }

  else {
    next_state = "clarify_intent";
    reply = "No worries. I just want to make sure I’m helping properly — are you looking to book, reschedule, cancel, or ask a general question?";
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
    return res.status(500).json({ ok: false, error: updateError.message });
  }

  return res.status(200).json({
    ok: true,
    call_id,
    intent,
    previous_state,
    next_state,
    resume_state: updates.resume_state ?? state.resume_state,
    reply,
    updates
  });
}
