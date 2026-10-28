import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./style.css";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || "سبب الخطأ غير متاح"
    };
  }

  componentDidCatch(error) {
    console.error("Al-Mohami UI render error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main style={{ maxWidth: 720, margin: "8vh auto", padding: 24, fontFamily: "Tahoma, Arial, sans-serif", direction: "rtl", color: "#17243a" }}>
          <section style={{ background: "#fff", border: "1px solid #e1e8f0", borderRadius: 20, padding: 28 }}>
            <h1>تعذّر عرض الواجهة</h1>
            <p style={{ lineHeight: 1.9, color: "#627087" }}>تم تحميل التطبيق، لكن حدث خطأ أثناء عرض الواجهة. أظهرنا تفاصيل الخطأ لتحديد السبب وإصلاحه.</p>
            <pre dir="ltr" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#f5f7fa", padding: 12, borderRadius: 8 }}>{this.state.errorMessage}</pre>
            <button onClick={() => location.reload()} style={{ border: 0, borderRadius: 10, background: "#244e70", color: "#fff", padding: "11px 16px", font: "inherit" }}>إعادة المحاولة</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");
if (rootElement) {
  try {
    createRoot(rootElement).render(
      <React.StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </React.StrictMode>
    );
  } catch (error) {
    console.error("Al-Mohami startup error:", error);
    rootElement.innerHTML = '<main dir="rtl" style="max-width:720px;margin:8vh auto;padding:24px;font-family:Tahoma,Arial,sans-serif"><h1>تعذّر تشغيل الواجهة</h1><p>أعد تحميل الصفحة. إذا استمرت المشكلة، أرسل لقطة شاشة لهذه الرسالة.</p><button onclick="location.reload()">إعادة تحميل الصفحة</button></main>';
  }
}
