const SYSTEM_INSTRUCTION = `أنت مساعد معلومات قانونية عامة يركز على القانون المغربي ومدونة الأسرة المغربية. لست محامياً ولا تمثل أي جهة حكومية.

قواعد إلزامية:
1. أجب بالعربية الواضحة، ويمكن استعمال الدارجة المغربية إذا كان السؤال بالدارجة.
2. لا تخترع مواد قانونية أو أرقام فصول أو آجالاً أو وثائق أو أحكاماً قضائية. إذا لم تكن متأكداً من رقم مادة أو من كون النص ما زال سارياً، قل ذلك بوضوح ولا تذكر الرقم كتأكيد.
3. عند الحاجة إلى معلومة قانونية حديثة، استخدم البحث المتاح للوصول إلى المصادر الرسمية المغربية، وامنح الأولوية لبوابة عدالة التابعة لوزارة العدل (adala.justice.gov.ma) وموقع وزارة العدل (justice.gov.ma) والجريدة الرسمية. لا تعتبر نتائج البحث وحدها نصاً قانونياً رسمياً إذا لم يتضح مصدرها.
4. لا تدّع أنك تحققت من نص رسمي ما لم تدعم نتيجة البحث ذلك فعلاً. إذا لم تعثر على مصدر رسمي واضح، صرّح بذلك ووجّه المستخدم للتحقق من https://adala.justice.gov.ma/resources/22 أو https://www.justice.gov.ma/.
5. وضّح الفرق بين المعلومة العامة والاستشارة الخاصة بالملف. عند اعتماد النتيجة على تفاصيل أو وثائق أو آجال أو تغييرات تشريعية، انصح بمراجعة محامٍ أو الجهة المختصة.
6. لا تضمن نتيجة قضية ولا تعطِ تعليمات للتحايل على القانون أو إخفاء الأدلة أو تهديد أي شخص.
7. إذا كان السؤال خارج القانون المغربي أو خارج نطاق الأسرة، اشرح حدود نطاقك وأجب فقط عن المبادئ العامة التي تعرفها بثقة.
8. لا تطلب الاسم الكامل أو رقم البطاقة الوطنية أو العنوان أو أسماء الأطفال أو أي معلومات شخصية حساسة. اطلب تفاصيل عامة فقط إذا لزم الأمر.
9. رتّب الإجابة بهذا الشكل عند ملاءمته: (أ) جواب مختصر، (ب) ما الذي قد يؤثر في الحالة، (ج) خطوات عامة للتحقق أو المتابعة، (د) ما الذي ينبغي تأكيده من المصدر الرسمي. لا تضع عناوين فارغة إذا لم تلزم.
10. لا تخترع روابط لصفحات داخلية أو ملفات.
11. اذكر باختصار عند الحاجة: هذه معلومات عامة وليست استشارة قانونية خاصة.`;

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
  const transcript = [];
  for (const item of history) {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.text !== "string") continue;
    const text = item.text.trim().slice(0, 2000);
    if (!text) continue;
    transcript.push((item.role === "assistant" ? "المساعد" : "المستخدم") + ": " + text);
  }
  transcript.push("سؤال المستخدم الحالي: " + question);

  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  let upstream;
  try {
    upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        model,
        input: transcript.join("\n\n"),
        system_instruction: SYSTEM_INSTRUCTION,
        tools: [{ type: "google_search" }],
        store: false,
        generation_config: { temperature: 0.2, max_output_tokens: 1200 }
      })
    });
  } catch (error) {
    console.error("Gemini connection failure:", error?.name || "network_error");
    return json({ error: "تعذّر الاتصال بخدمة الإجابة. حاول مرة أخرى لاحقًا." }, 502);
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    console.error("Gemini API error:", JSON.stringify({
      http_status: upstream.status,
      provider_status: data?.error?.status || null,
      provider_message: typeof data?.error?.message === "string" ? data.error.message.slice(0, 500) : null
    }));
    if (upstream.status === 429) {
      return json({ error: "وصلت الخدمة إلى حد الاستخدام المؤقت. انتظر قليلًا ثم حاول مجددًا." }, 429);
    }
    if (upstream.status === 401 || upstream.status === 403) {
      return json({ error: "رفضت خدمة Gemini المفتاح أو صلاحية الوصول. تحقّق من المفتاح وصلاحيته في Google AI Studio." }, 502);
    }
    if (upstream.status === 404) {
      return json({ error: "لم يتم العثور على نموذج Gemini المحدد. تحقّق من اسم النموذج في إعدادات الخدمة." }, 502);
    }
    return json({ error: "تعذّر إنشاء الإجابة الآن. سجّل الخادم تفاصيل الخطأ للمراجعة." }, 502);
  }

  const output = Array.isArray(data.output) ? data.output : [];
  const answer = output
    .filter(item => item && item.type === "text" && typeof item.text === "string")
    .map(item => item.text)
    .join("\n")
    .trim();

  if (!answer) {
    console.error("Gemini returned no text output:", JSON.stringify({
      status: data?.status || null,
      output_types: output.map(item => item?.type).filter(Boolean)
    }));
    return json({ error: "لم تصل إجابة واضحة. أعد صياغة السؤال وحاول مجددًا." }, 502);
  }
  return json({ answer });
}

export async function onRequestGet() {
  return json({ error: "استخدم POST لإرسال سؤال." }, 405);
}
