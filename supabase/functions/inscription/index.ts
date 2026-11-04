// Endpoint d'inscription mini-livre ORA
// POST { prenom, email, lettres?, entreprise? }
// → crée le contact Brevo (Mini-livre toujours ; + Lettres si case cochée)
// → envoie l'e-mail de livraison du PDF (transactionnel Brevo)
// Secrets (supabase secrets set) : BREVO_API_KEY, PDF_URL, ALLOWED_ORIGIN

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const PDF_URL = Deno.env.get("PDF_URL") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const LIST_MINILIVRE = Number(Deno.env.get("LIST_MINILIVRE") ?? "4");
const LIST_LETTRES = Number(Deno.env.get("LIST_LETTRES") ?? "3");
const SENDER_NAME = Deno.env.get("SENDER_NAME") ?? "ORA";
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") ?? "ora.oser80@gmail.com";
const LETTRES_FORM_URL = Deno.env.get("LETTRES_FORM_URL") ?? "";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const brevo = (path: string, payload: unknown) =>
  fetch(`https://api.brevo.com/v3${path}`, {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

function deliveryEmail(prenom: string): string {
  return `<p>Bonjour ${prenom},</p>
<p>Merci pour ton inscription et bienvenue dans l'univers ORA.</p>
<p>Tu vas pouvoir découvrir le mini-livre « Tu t'arrêtes quand ? ».</p>
<p><strong><a href="${PDF_URL}">Ton mini-livre t'attend ici</a></strong></p>
<p>Prends le temps de le découvrir à ton rythme. Il n'y a rien à réussir, simplement des choses à observer et peut-être quelques déclics à laisser émerger.</p>
<p>Et la suite de l'aventure ?</p>
<p>ORA continuera à partager des réflexions, des expériences et des pistes pour explorer ton quotidien autrement.</p>
<p>Tu souhaites recevoir les prochaines lettres d'ORA ? <a href="${LETTRES_FORM_URL}">Tu peux choisir de t'y inscrire ici</a>.</p>
<p>À bientôt,<br/>ORA<br/><em>Le voyage vers soi est une aventure.</em></p>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const prenom = String(body.prenom ?? "").trim().slice(0, 100);
  const email = String(body.email ?? "").trim().toLowerCase();
  const lettres = body.lettres === true;

  // Honeypot anti-bot : champ invisible rempli par les bots uniquement
  if (body.entreprise) return json({ ok: true });

  if (!prenom || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ ok: false, error: "invalid_input" }, 400);

  // 1. Contact Brevo : Mini-livre toujours, + Lettres si consentement
  const listIds = lettres ? [LIST_MINILIVRE, LIST_LETTRES] : [LIST_MINILIVRE];
  const c = await brevo("/contacts", {
    email,
    attributes: { PRENOM: prenom },
    listIds,
    updateEnabled: true,
  });
  if (!c.ok) {
    const err = await c.text();
    console.error("brevo contact failed", c.status, err);
    return json({ ok: false, error: "contact_failed" }, 502);
  }

  // 2. E-mail de livraison du mini-livre (transactionnel)
  const m = await brevo("/smtp/email", {
    sender: { name: SENDER_NAME, email: SENDER_EMAIL },
    to: [{ email, name: prenom }],
    subject: 'Ton mini-livre « Tu t\'arrêtes quand ? » est prêt',
    htmlContent: deliveryEmail(prenom),
  });
  if (!m.ok) {
    const err = await m.text();
    console.error("brevo email failed", m.status, err);
    // Le contact est créé : on le signale mais on ne bloque pas l'inscrite
    return json({ ok: true, warn: "email_failed" });
  }

  return json({ ok: true, lettres });
});
