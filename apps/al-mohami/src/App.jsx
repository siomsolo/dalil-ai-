import React, { useEffect, useRef, useState } from "react";
import { Scale, Send, ShieldCheck, BookOpen, MessageCircle, RotateCcw, ExternalLink, Sparkles, Info } from "lucide-react";

const suggestions = [
  "كيف تُحدَّد نفقة الأطفال بعد الطلاق؟",
  "ما الفرق بين الحضانة وحق الزيارة؟",
  "ما الخطوات العامة لطلب الطلاق؟",
  "ما الوثائق التي قد أحتاجها في قضية أسرية؟"
];

const officialSources = [
  {
    name: "بوابة عدالة — وزارة العدل",
    detail: "البوابة الرسمية للتشريع والاجتهاد القضائي",
    url: "https://adala.justice.gov.ma/resources/22"
  },
  {
    name: "وزارة العدل المغربية",
    detail: "الموقع الرسمي للوزارة",
    url: "https://www.justice.gov.ma/"
  }
];

function Message({ item }) {
  return (
    <div className={`message-row ${item.role === "user" ? "user-row" : "assistant-row"}`}>
      {item.role !== "user" && <div className="avatar assistant-avatar"><Scale size={18} /></div>}
      <div className={`message-bubble ${item.role === "user" ? "user-bubble" : "assistant-bubble"}`}>
        {item.role === "assistant" && <div className="answer-label"><Sparkles size={14} /> إجابة عامة</div>}
        <div className="message-text">{item.text}</div>
        {item.role === "assistant" && item.sources && (
          <div className="answer-source">
            <BookOpen size={15} />
            <span>للمراجعة، راجع المصادر الرسمية أسفل الصفحة.</span>
          </div>
        )}
      </div>
      {item.role === "user" && <div className="avatar user-avatar">أنت</div>}
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  async function sendMessage(text = input) {
    const question = text.trim();
    if (!question || busy) return;
    if (question.length > 2000) {
      setError("يرجى اختصار السؤال إلى 2000 حرف أو أقل.");
      return;
    }
    setError("");
    setInput("");
    const nextMessages = [...messages, { role: "user", text: question }];
    setMessages(nextMessages);
    setBusy(true);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history: messages.slice(-8).map(({ role, text }) => ({ role, text }))
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "تعذّر الحصول على إجابة الآن. حاول مرة أخرى لاحقًا.");
      setMessages(current => [...current, { role: "assistant", text: data.answer, sources: true }]);
    } catch (e) {
      setError(e.message || "حدث خطأ في الاتصال. حاول مرة أخرى.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function resetChat() {
    setMessages([]);
    setInput("");
    setError("");
    inputRef.current?.focus();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="محامي الأسرة المغربية - الصفحة الرئيسية">
          <span className="brand-mark"><Scale size={22} /></span>
          <span><strong>محامي الأسرة المغربية</strong><small>معلومات قانونية مغربية مبسّطة</small></span>
        </a>
        <span className="free-pill"><span className="status-dot" /> مجاني حاليًا</span>
      </header>

      <main className="main-layout">
        <section className="intro-panel">
          <div className="eyebrow"><ShieldCheck size={15} /> معرفة قانونية أوضح</div>
          <h1>عندك سؤال قانوني؟<br /><span>ابدأ من هنا.</span></h1>
          <p className="intro-copy">اسأل عن المسائل العامة في مدونة الأسرة المغربية، مثل النفقة والحضانة والطلاق والزيارة. سنساعدك على فهم الموضوع والخطوات التي يمكنك التحقق منها.</p>
          <div className="trust-points">
            <div><span className="point-icon"><BookOpen size={17} /></span><span><b>مصادر رسمية</b><small>روابط للرجوع إلى بوابة وزارة العدل</small></span></div>
            <div><span className="point-icon"><MessageCircle size={17} /></span><span><b>شرح بلغة واضحة</b><small>إجابات مبسطة دون مصطلحات معقدة قدر الإمكان</small></span></div>
          </div>
        </section>

        <section className="chat-panel" aria-label="محادثة قانونية">
          <div className="chat-header">
            <div className="chat-title">
              <span className="chat-icon"><Scale size={19} /></span>
              <span><strong>اسأل محامي الأسرة المغربية</strong><small>الموضوع الأول: مدونة الأسرة المغربية</small></span>
            </div>
            {messages.length > 0 && <button className="reset-button" onClick={resetChat} title="محادثة جديدة"><RotateCcw size={15} /><span>محادثة جديدة</span></button>}
          </div>

          <div className="chat-content" ref={listRef}>
            {messages.length === 0 ? (
              <div className="welcome-state">
                <div className="welcome-icon"><MessageCircle size={25} /></div>
                <h2>كيف يمكنني مساعدتك؟</h2>
                <p>اكتب سؤالك بشكل عام، ولا تضع أسماءك الكاملة أو أرقام الهوية أو تفاصيل شخصية حساسة.</p>
                <div className="suggestions">
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} className="suggestion" onClick={() => sendMessage(suggestion)} disabled={busy}>
                      <span>{suggestion}</span><span className="suggestion-arrow">←</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="message-list">
                {messages.map((item, index) => <Message item={item} key={index} />)}
                {busy && <div className="message-row assistant-row"><div className="avatar assistant-avatar"><Scale size={18} /></div><div className="message-bubble assistant-bubble loading-bubble"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /><span className="loading-text">أراجع السؤال وأجهّز إجابة...</span></div></div>}
              </div>
            )}
          </div>

          {error && <div className="error-banner" role="alert">{error}</div>}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); sendMessage(); }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="اكتب سؤالك القانوني هنا..."
              aria-label="اكتب سؤالك القانوني"
              rows={2}
              maxLength={2000}
              disabled={busy}
            />
            <div className="composer-bottom">
              <span className="privacy-note"><ShieldCheck size={14} /> يُرسل سؤالك إلى خدمة ذكاء اصطناعي للإجابة؛ لا تكتب بيانات شخصية أو حساسة.</span>
              <button className="send-button" type="submit" disabled={busy || !input.trim()}><span>إرسال السؤال</span><Send size={16} /></button>
            </div>
          </form>
          <p className="chat-footnote">لا تستخدم الأداة للحالات الطارئة أو لاتخاذ قرار قانوني نهائي دون التحقق.</p>
        </section>
      </main>

      <section className="legal-notice-section" aria-label="تنبيه قانوني">
        <div className="notice-card">
          <Info size={18} />
          <p><strong>تنبيه مهم</strong><br />هذه الأداة للمعلومات العامة وليست مكتب محاماة، ولا تعوّض استشارة محامٍ مؤهل. قد تخطئ الإجابات؛ تحقّق من النص القانوني الرسمي قبل اتخاذ أي قرار.</p>
        </div>
      </section>

      <section className="sources-section">
        <div className="sources-heading"><div><span className="section-kicker">تحقّق بنفسك</span><h2>مصادر رسمية</h2></div><p>استخدم الروابط الرسمية للتحقق من النصوص القانونية والإجراءات الحالية.</p></div>
        <div className="source-grid">
          {officialSources.map(source => (
            <a className="source-card" href={source.url} target="_blank" rel="noreferrer" key={source.url}>
              <span className="source-icon"><BookOpen size={19} /></span>
              <span className="source-copy"><strong>{source.name}</strong><small>{source.detail}</small></span>
              <ExternalLink size={16} className="external-icon" />
            </a>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>محامي الأسرة المغربية © {new Date().getFullYear()}</span>
        <span>أداة معلوماتية مستقلة، وليست جهة حكومية أو مكتب محاماة.</span>
      </footer>
    </div>
  );
}
