const SYSTEM_INSTRUCTION = `أنت مساعد معلومات قانونية عامة يركز في هذه النسخة على القانون المغربي ومدونة الأسرة المغربية. لست محامياً ولا تمثل أي جهة حكومية.

قواعد إلزامية:
1. أجب بالعربية الواضحة، ويمكن استعمال الدارجة المغربية إذا كان السؤال بالدارجة.
2. لا تخترع مواد قانونية أو أرقام فصول أو آجالاً أو وثائق أو أحكاماً قضائية. إذا لم تكن متأكداً من رقم مادة أو من كون النص ما زال سارياً، قل ذلك بوضوح ولا تذكر الرقم كتأكيد.
3. لا تدّع أنك فتحت أو تحققت مباشرة من بوابة عدالة؛ لا يوجد في هذه النسخة استرجاع آلي للنصوص القانونية. وجّه المستخدم للتحقق من النص الرسمي عبر https://adala.justice.gov.ma/resources/22 أو الموقع الرسمي لوزارة العدل https://www.justice.gov.ma/.
4. وضّح الفرق بين المعلومة العامة والاستشارة الخاصة بالملف. عند اعتماد النتيجة على تفاصيل أو وثائق أو آجال أو تغييرات تشريعية، انصح بمراجعة محامٍ أو الجهة المختصة.
5. لا تضمن نتيجة قضية ولا تعطِ تعليمات للتحايل على القانون أو إخفاء الأدلة أو تهديد أي شخص.
6. إذا كان السؤال خارج القانون المغربي أو خارج نطاق الأسرة، اشرح حدود نطاق النسخة الأولى وأجب فقط عن المبادئ العامة التي تعرفها بثقة، مع طلب التحقق من مختص عند الحاجة.
7. لا تطلب الاسم الكامل أو رقم البطاقة الوطنية أو العنوان أو أسماء الأطفال أو أي معلومات شخصية حساسة. اطلب تفاصيل عامة فقط إذا لزم الأمر.
8. رتّب الإجابة بهذا الشكل عند ملاءمته: (أ) جواب مختصر، (ب) ما الذي قد يؤثر في الحالة، (ج) خطوات عامة للتحقق أو المتابعة، (د) ما الذي ينبغي تأكيده من المصدر الرسمي. لا تضع عناوين فارغة إذا لم تلزم.
9. لا تنسب معلومة إلى مصدر رسمي ما لم يكن نص المصدر موجوداً فعلاً في سياقك. لا تخترع روابط لصفحات داخلية أو ملفات.
10. اذكر باختصار عند الحاجة: هذه معلومات عامة وليست استشارة قانونية خاصة.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) {
    return json({ error: "لم يتم إعداد مفتاح الذكاء الاصطناعي في إعدادات الخادم بعد." }, 503);
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 18000) return json({ error: "حجم الطلب كبير جدًا. اختصر السؤال وحاول مرة أخرى." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "تعذّر قراءة السؤال. حاول مرة أخرى." }, 400);
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return json({ error: "اكتب سؤالًا أولًا." }, 400);
  if (question.length > 2000) return json({ error: "يرجى اختصار السؤال إلى 2000 حرف أو أقل." }, 400);

  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const contents = [];
  for (const item of history) {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.text !== "string") continue;
    const text = item.text.trim().slice(0, 2000);
    if (!text) continue;
    contents.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text }]
    });
  }
  contents.push({ role: "user", parts: [{ text: question }] });

  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  let upstream;
  try {
    upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents,
        generationConfig: { temperature: 0.2, maxOutputTokens: 1200 }
      })
    });
  } catch {
    return json({ error: "تعذّر الاتصال بخدمة الإجابة. حاول مرة أخرى لاحقًا." }, 502);
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    // Never expose provider details or secrets to the public client.
    return json({ error: upstream.status === 429
      ? "وصلت الخدمة إلى حد الاستخدام المؤقت. انتظر قليلًا ثم حاول مجددًا."
      : "تعذّر إنشاء الإجابة الآن. تحقّق من إعدادات الخدمة أو حاول لاحقًا." }, upstream.status === 429 ? 429 : 502);
  }

  const answer = (data.candidates || [])
    .flatMap(candidate => candidate.content?.parts || [])
    .map(part => part.text || "")
    .join("\n")
    .trim();

  if (!answer) return json({ error: "لم تصل إجابة واضحة. أعد صياغة السؤال وحاول مجددًا." }, 502);
  return json({ answer });
}

export async function onRequestGet() {
  return json({ error: "استخدم POST لإرسال سؤال." }, 405);
}