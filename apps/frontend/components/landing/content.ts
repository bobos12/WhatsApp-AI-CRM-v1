// ─────────────────────────────────────────────────────────────────────────────
// Bilingual marketing content for the premium landing page.
// Self-contained (not wired into the global i18n namespaces) so the marketing
// site can evolve independently. Keyed by language; the page reads the active
// language from useLanguage() and re-renders on switch — RTL flips seamlessly.
// ─────────────────────────────────────────────────────────────────────────────

export type LandingLang = 'en' | 'ar'

export interface LandingContent {
  nav: {
    links: { id: string; label: string }[]
    signIn: string
    getStarted: string
    menu: string
  }
  hero: {
    badge: string
    titlePre: string
    titleGold: string
    titlePost: string
    subtitle: string
    ctaPrimary: string
    ctaSecondary: string
    ratingLabel: string
    noCard: string
    floating: { online: string; replies: string; csat: string; aiHandled: string }
    chat: {
      contactName: string
      status: string
      inbound1: string
      outbound1: string
      inbound2: string
      orderTag: string
    }
  }
  trust: { label: string }
  stats: { value: number; suffix: string; label: string }[]
  features: {
    eyebrow: string
    title: string
    titleMuted: string
    subtitle: string
    items: { key: string; title: string; desc: string }[]
  }
  ai: {
    eyebrow: string
    title: string
    titleGold: string
    subtitle: string
    capabilities: { key: string; title: string; desc: string }[]
    panelTitle: string
    suggestionLabel: string
    suggestion: string
    sentimentLabel: string
    sentiment: string
    insertCta: string
    customerMsg: string
    composerPlaceholder: string
  }
  workflow: {
    eyebrow: string
    title: string
    subtitle: string
    steps: { key: string; title: string; desc: string }[]
  }
  industries: {
    eyebrow: string
    title: string
    subtitle: string
    items: { key: string; label: string }[]
  }
  showcase: {
    eyebrow: string
    title: string
    titleGold: string
    subtitle: string
    bullets: string[]
    url: string
  }
  /** Product tour — one tab per screen, each backed by a real screenshot. */
  tour: {
    eyebrow: string
    title: string
    titleGold: string
    subtitle: string
    items: { key: string; label: string; title: string; desc: string; bullets: string[] }[]
  }
  mobile: {
    eyebrow: string
    title: string
    titleGold: string
    subtitle: string
    bullets: string[]
  }
  testimonials: {
    eyebrow: string
    title: string
    items: { quote: string; author: string; role: string }[]
  }
  pricing: {
    eyebrow: string
    title: string
    subtitle: string
    perMonth: string
    mostPopular: string
    plans: {
      key: string
      name: string
      price: string
      sub: string
      features: string[]
      cta: string
      highlight: boolean
    }[]
  }
  faq: {
    eyebrow: string
    title: string
    subtitle: string
    items: { q: string; a: string }[]
  }
  finalCta: {
    title: string
    subtitle: string
    primary: string
    secondary: string
    reassurance: string
  }
  footer: {
    tagline: string
    columns: { title: string; links: string[] }[]
    rights: string
    disclaimer: string
    badges: string[]
  }
}

export const LANDING: Record<LandingLang, LandingContent> = {
  // ═══════════════════════════════════════════ ENGLISH ═══════════════════════
  en: {
    nav: {
      links: [
        { id: 'product', label: 'Product' },
        { id: 'features', label: 'Features' },
        { id: 'ai', label: 'AI' },
        { id: 'industries', label: 'Solutions' },
        { id: 'pricing', label: 'Pricing' },
        { id: 'faq', label: 'FAQ' },
      ],
      signIn: 'Sign in',
      getStarted: 'Get Started',
      menu: 'Menu',
    },
    hero: {
      badge: 'The WhatsApp Business Platform for Saudi Arabia',
      titlePre: 'Turn WhatsApp conversations into ',
      titleGold: 'real revenue',
      titlePost: '',
      subtitle:
        'One intelligent platform to manage every customer chat, automate replies with AI, run broadcast campaigns, and grow your team — all on the channel your customers already use every day.',
      ctaPrimary: 'Start Free — No Card Needed',
      ctaSecondary: 'Book a Demo',
      ratingLabel: '4.9 / 5 from Saudi businesses',
      noCard: 'No credit card required · Set up in 10 minutes · Cancel anytime',
      floating: {
        online: 'Live now',
        replies: 'Avg. reply time',
        csat: 'Customer satisfaction',
        aiHandled: 'Handled by AI',
      },
      chat: {
        contactName: 'Sara Al-Otaibi',
        status: 'online',
        inbound1: 'Hi! Is my order ready?',
        outbound1: 'Yes! Order #2847 is confirmed and ships today 🎉',
        inbound2: 'Perfect, thank you so much 🙏',
        orderTag: 'AI replied in 2s',
      },
    },
    trust: { label: 'Trusted by ambitious teams across the Kingdom' },
    stats: [
      { value: 500, suffix: '+', label: 'businesses onboard' },
      { value: 2, suffix: 'M+', label: 'messages / day' },
      { value: 99.9, suffix: '%', label: 'uptime SLA' },
      { value: 10, suffix: 'x', label: 'faster responses' },
    ],
    features: {
      eyebrow: 'Platform',
      title: 'Everything your business needs',
      titleMuted: 'on WhatsApp',
      subtitle:
        'Messaging, automation, contacts, campaigns, and analytics — unified in one premium platform, so your team never switches tools again.',
      items: [
        { key: 'inbox', title: 'Shared Team Inbox', desc: 'Route, assign, and reply to thousands of conversations together — with internal notes, tags, and zero missed messages.' },
        { key: 'ai', title: 'AI Assistant', desc: 'An always-on agent that qualifies leads, answers FAQs, and drafts smart replies in Arabic and English, 24/7.' },
        { key: 'broadcast', title: 'Broadcast Campaigns', desc: 'Send approved WhatsApp templates to segmented audiences and watch delivery, opens, and replies update live.' },
        { key: 'automation', title: 'Visual Automation', desc: 'Build no-code flows that trigger on keywords, events, and customer behaviour — follow-ups that never sleep.' },
        { key: 'crm', title: 'Customer Profiles', desc: 'Every contact, order, note, and conversation in one rich timeline your whole team can see and act on.' },
        { key: 'analytics', title: 'Live Analytics', desc: 'Track response times, campaign conversions, agent performance, and revenue impact in real time.' },
      ],
    },
    ai: {
      eyebrow: 'AI-first',
      title: 'Let AI handle the busywork,',
      titleGold: 'your team closes the deals',
      subtitle:
        'Our AI reads every conversation, understands intent in Arabic and English, and acts — so your agents focus on what humans do best.',
      capabilities: [
        { key: 'replies', title: 'Smart auto-replies', desc: 'Instant, on-brand answers to common questions.' },
        { key: 'qualify', title: 'Lead qualification', desc: 'Scores and routes hot leads to the right agent.' },
        { key: 'summary', title: 'Conversation summaries', desc: 'One-line recaps of long chats before you reply.' },
        { key: 'sentiment', title: 'Sentiment detection', desc: 'Flags unhappy customers before they churn.' },
        { key: 'suggest', title: 'Suggested replies', desc: 'AI-drafted responses your agents send in a tap.' },
        { key: 'translate', title: 'Arabic ↔ English', desc: 'Understands and replies fluently in both.' },
      ],
      panelTitle: 'AI Copilot',
      suggestionLabel: 'Suggested reply',
      suggestion: 'Your order #2847 has shipped and will arrive tomorrow before 6 PM. Here is your tracking link 📦',
      sentimentLabel: 'Sentiment',
      sentiment: 'Positive · ready to buy',
      insertCta: 'Insert reply',
      customerMsg: 'Hi! Is my order ready? 😊',
      composerPlaceholder: 'Type a reply…',
    },
    workflow: {
      eyebrow: 'How it works',
      title: 'From first message to closed deal',
      subtitle: 'A connected flow where every step updates the next — automatically.',
      steps: [
        { key: 'customer', title: 'Customer messages', desc: 'A customer reaches out on WhatsApp — day or night.' },
        { key: 'ai', title: 'AI responds instantly', desc: 'The assistant answers, qualifies, and gathers context.' },
        { key: 'team', title: 'Team takes over', desc: 'Hot conversations route to the right agent with full history.' },
        { key: 'crm', title: 'CRM stays in sync', desc: 'Contacts, deals, and notes update automatically.' },
        { key: 'reports', title: 'Reports reveal growth', desc: 'Live dashboards show what is working and what to scale.' },
      ],
    },
    industries: {
      eyebrow: 'Solutions',
      title: 'Built for every Saudi business',
      subtitle: 'From a single boutique to a national enterprise — the platform adapts to how you sell.',
      items: [
        { key: 'restaurants', label: 'Restaurants & Cafés' },
        { key: 'clinics', label: 'Clinics & Healthcare' },
        { key: 'realestate', label: 'Real Estate' },
        { key: 'retail', label: 'Retail & Stores' },
        { key: 'ecommerce', label: 'E-commerce' },
        { key: 'education', label: 'Education' },
        { key: 'automotive', label: 'Automotive' },
        { key: 'agencies', label: 'Marketing Agencies' },
      ],
    },
    showcase: {
      eyebrow: 'The product',
      title: 'A command center for',
      titleGold: 'every conversation',
      subtitle:
        'Real WhatsApp rendering — bubbles, ticks, reactions, replies, and interactive buttons exactly as your customers see them. No broken previews, no surprises.',
      bullets: [
        'Pixel-perfect WhatsApp message previews',
        'Multi-agent inbox with live presence',
        'Drag-and-drop campaign builder',
        'Meta Business API + Baileys with auto-failover',
      ],
      url: 'app.nexuscrm.sa/inbox',
    },
    tour: {
      eyebrow: 'Product tour',
      title: 'Six systems.',
      titleGold: 'One platform.',
      subtitle: 'Every screen below is the real product, captured from the running app — not a mockup.',
      items: [
        {
          key: 'inbox',
          label: 'Shared Inbox',
          title: 'One line. Your whole team.',
          desc: 'Sales, support and design work the same WhatsApp number without two people answering the same customer.',
          bullets: ['Round-robin assignment inside working hours', 'Internal notes, tags and saved views', 'Full customer history beside every thread'],
        },
        {
          key: 'automation',
          label: 'Automation',
          title: 'Automate the follow-up.',
          desc: 'Trigger-based workflows qualify a lead, route it to the right team and chase it later — without anyone remembering to.',
          bullets: ['Triggers on real events, not schedules', 'Branches on score, language and working hours', 'Delays that cancel themselves when the customer replies'],
        },
        {
          key: 'deals',
          label: 'Pipeline',
          title: 'Turn chats into deals.',
          desc: 'A drag-and-drop board that tracks value by stage, so you can see where the money is stuck and who is sitting on it.',
          bullets: ['Stages that match how you actually sell', 'Value and conversion roll up automatically', 'AI-scored leads arrive already ranked'],
        },
        {
          key: 'broadcasts',
          label: 'Campaigns',
          title: 'Broadcast at scale.',
          desc: 'Thousands of segmented messages with per-recipient delivery tracking — and warm-up limits that keep your number alive.',
          bullets: ['Segment by tag, stage or custom field', 'Ban-safe send pacing enforced by the sender', 'Delivered, read and replied, per campaign'],
        },
        {
          key: 'analytics',
          label: 'Analytics',
          title: 'Measure everything.',
          desc: 'Response times, resolution rates, agent workload, campaign results and AI impact — on one board-ready screen.',
          bullets: ['First-response time per agent', 'Revenue traced back to the first message', 'What share of chats the AI closed alone'],
        },
      ],
    },
    mobile: {
      eyebrow: 'Mobile',
      title: 'Your inbox,',
      titleGold: 'in your pocket',
      subtitle: 'Install it like a native app. The same inbox, the same CRM, the same notifications — on the phone your team already carries.',
      bullets: [
        'Installable PWA — no app store review',
        'Web push for hot leads and SLA breaches',
        'Works offline-first and syncs on reconnect',
      ],
    },
    testimonials: {
      eyebrow: 'Customer stories',
      title: 'Loved by leading Saudi teams',
      items: [
        { quote: 'We went from juggling WhatsApp on personal phones to routing 3,000 conversations a day through one team inbox. Response time dropped by 80%.', author: 'Sara Al-Rashid', role: 'Head of Support, NovaMart' },
        { quote: 'The broadcast templates render exactly like real WhatsApp messages — finally a tool that does not embarrass us in front of customers.', author: 'Khalid Al-Harbi', role: 'Growth Lead, Tamkeen' },
        { quote: 'The AI handles 70% of inbound questions before a human even sees them. Our small team now performs like an enterprise call center.', author: 'Noura Al-Qahtani', role: 'CEO, FastShip Logistics' },
      ],
    },
    pricing: {
      eyebrow: 'Pricing',
      title: 'Simple, transparent pricing',
      subtitle: 'Start free. Scale when you grow. No hidden fees, cancel anytime.',
      perMonth: '/ month',
      mostPopular: 'Most Popular',
      plans: [
        { key: 'starter', name: 'Starter', price: 'Free', sub: 'Forever free for small teams', features: ['1 WhatsApp number', 'Up to 500 contacts', '3 team members', 'Basic automation', 'Community support'], cta: 'Get Started Free', highlight: false },
        { key: 'pro', name: 'Professional', price: '199 ﷼', sub: 'Billed monthly · save 20% yearly', features: ['3 WhatsApp numbers', 'Up to 10,000 contacts', 'Unlimited team members', 'AI assistant + advanced automation', 'Broadcast campaigns', 'Priority support'], cta: 'Start Free Trial', highlight: true },
        { key: 'enterprise', name: 'Enterprise', price: 'Custom', sub: 'Self-hosted or managed cloud', features: ['Unlimited numbers & contacts', 'White-label option', 'Custom integrations', 'Dedicated infrastructure', 'SLA + onboarding manager'], cta: 'Contact Sales', highlight: false },
      ],
    },
    faq: {
      eyebrow: 'FAQ',
      title: 'Questions, answered',
      subtitle: 'Everything you need to know before getting started.',
      items: [
        { q: 'Do I need the official WhatsApp Business API?', a: 'You can start in minutes by scanning a QR code with our Baileys provider, or connect the official Meta Business API for higher volume and verified templates. The platform supports both — and fails over automatically.' },
        { q: 'Does it fully support Arabic?', a: 'Yes. The entire platform, the AI assistant, and message templates are fully bilingual with native right-to-left support, built specifically for the Saudi market.' },
        { q: 'How long does setup take?', a: 'Most businesses are live in under 10 minutes — connect your number, import contacts, and start messaging. No developers required.' },
        { q: 'Is my data secure and private?', a: 'Your data is encrypted in transit and at rest, hosted in compliant infrastructure. Enterprise plans can be fully self-hosted on your own servers.' },
        { q: 'Can I migrate my existing contacts?', a: 'Absolutely. Import via CSV, sync from your current CRM, or let conversations auto-create contacts as customers message you.' },
      ],
    },
    finalCta: {
      title: 'Ready to turn WhatsApp into your #1 sales channel?',
      subtitle: 'Join hundreds of Saudi businesses delivering faster support, smarter campaigns, and more closed deals — every single day.',
      primary: 'Start Free Today',
      secondary: 'Talk to Sales',
      reassurance: 'No credit card required · Set up in 10 minutes · Cancel anytime',
    },
    footer: {
      tagline: 'The premium WhatsApp CRM for modern Saudi businesses.',
      columns: [
        { title: 'Product', links: ['Features', 'AI Assistant', 'Pricing', 'Roadmap'] },
        { title: 'Solutions', links: ['Restaurants', 'Healthcare', 'Real Estate', 'E-commerce'] },
        { title: 'Company', links: ['About', 'Privacy', 'Terms', 'Contact'] },
      ],
      rights: 'All rights reserved.',
      disclaimer: 'Not affiliated with Meta Platforms Inc.',
      badges: ['GDPR ready', '99.9% uptime SLA', 'Hosted in-region'],
    },
  },

  // ═══════════════════════════════════════════ ARABIC ════════════════════════
  ar: {
    nav: {
      links: [
        { id: 'product', label: 'المنتج' },
        { id: 'features', label: 'المميزات' },
        { id: 'ai', label: 'الذكاء الاصطناعي' },
        { id: 'industries', label: 'الحلول' },
        { id: 'pricing', label: 'الأسعار' },
        { id: 'faq', label: 'الأسئلة' },
      ],
      signIn: 'تسجيل الدخول',
      getStarted: 'ابدأ الآن',
      menu: 'القائمة',
    },
    hero: {
      badge: 'منصة واتساب للأعمال في المملكة العربية السعودية',
      titlePre: 'حوّل محادثات واتساب إلى ',
      titleGold: 'مبيعات حقيقية',
      titlePost: '',
      subtitle:
        'منصة ذكية واحدة لإدارة كل محادثة مع عملائك، وأتمتة الردود بالذكاء الاصطناعي، وإطلاق الحملات الجماعية، وتنمية فريقك — عبر القناة التي يستخدمها عملاؤك كل يوم.',
      ctaPrimary: 'ابدأ مجانًا — بدون بطاقة',
      ctaSecondary: 'احجز عرضًا توضيحيًا',
      ratingLabel: '4.9 / 5 من تقييم الشركات السعودية',
      noCard: 'بدون بطاقة ائتمان · الإعداد خلال 10 دقائق · إلغاء في أي وقت',
      floating: {
        online: 'متصل الآن',
        replies: 'متوسط زمن الرد',
        csat: 'رضا العملاء',
        aiHandled: 'يديرها الذكاء الاصطناعي',
      },
      chat: {
        contactName: 'سارة العتيبي',
        status: 'متصل',
        inbound1: 'مرحبًا! هل طلبي جاهز؟',
        outbound1: 'نعم! تم تأكيد الطلب رقم 2847 وسيُشحن اليوم 🎉',
        inbound2: 'ممتاز، شكرًا جزيلًا 🙏',
        orderTag: 'رد الذكاء الاصطناعي خلال ثانيتين',
      },
    },
    trust: { label: 'موثوق به من فرق طموحة في جميع أنحاء المملكة' },
    stats: [
      { value: 500, suffix: '+', label: 'شركة منضمة' },
      { value: 2, suffix: 'M+', label: 'رسالة / يوميًا' },
      { value: 99.9, suffix: '%', label: 'جاهزية الخدمة' },
      { value: 10, suffix: 'x', label: 'ردود أسرع' },
    ],
    features: {
      eyebrow: 'المنصة',
      title: 'كل ما يحتاجه عملك',
      titleMuted: 'على واتساب',
      subtitle:
        'المراسلة والأتمتة وجهات الاتصال والحملات والتحليلات — موحّدة في منصة واحدة متكاملة، فلا يحتاج فريقك للتنقل بين الأدوات بعد اليوم.',
      items: [
        { key: 'inbox', title: 'صندوق وارد مشترك', desc: 'وزّع المحادثات وأسندها وردّ على آلاف الرسائل معًا — مع ملاحظات داخلية ووسوم وبدون أي رسالة ضائعة.' },
        { key: 'ai', title: 'مساعد ذكي', desc: 'وكيل لا يتوقف يؤهّل العملاء المحتملين ويجيب عن الأسئلة الشائعة ويصوغ ردودًا ذكية بالعربية والإنجليزية على مدار الساعة.' },
        { key: 'broadcast', title: 'الحملات الجماعية', desc: 'أرسل قوالب واتساب المعتمدة لجماهير مقسّمة وراقب التسليم والفتح والردود لحظة بلحظة.' },
        { key: 'automation', title: 'أتمتة مرئية', desc: 'ابنِ مسارات بدون برمجة تنطلق عند الكلمات المفتاحية والأحداث وسلوك العملاء — متابعات لا تنام.' },
        { key: 'crm', title: 'ملفات العملاء', desc: 'كل جهة اتصال وطلب وملاحظة ومحادثة في سجلّ واحد غني يراه فريقك بالكامل ويتصرّف بناءً عليه.' },
        { key: 'analytics', title: 'تحليلات مباشرة', desc: 'تابع أزمنة الرد وتحويلات الحملات وأداء الموظفين وأثر الإيرادات في الوقت الفعلي.' },
      ],
    },
    ai: {
      eyebrow: 'الذكاء الاصطناعي أولًا',
      title: 'دع الذكاء الاصطناعي يتولّى المهام الروتينية،',
      titleGold: 'وفريقك يُغلق الصفقات',
      subtitle:
        'يقرأ الذكاء الاصطناعي كل محادثة، ويفهم النية بالعربية والإنجليزية، ويتصرّف — ليتفرّغ فريقك لما يتقنه البشر.',
      capabilities: [
        { key: 'replies', title: 'ردود تلقائية ذكية', desc: 'إجابات فورية ومتوافقة مع هوية علامتك.' },
        { key: 'qualify', title: 'تأهيل العملاء', desc: 'تقييم وتوجيه العملاء المهمين للموظف المناسب.' },
        { key: 'summary', title: 'تلخيص المحادثات', desc: 'ملخص بسطر واحد للمحادثات الطويلة قبل ردّك.' },
        { key: 'sentiment', title: 'تحليل المشاعر', desc: 'ينبّهك للعملاء غير الراضين قبل أن يغادروا.' },
        { key: 'suggest', title: 'ردود مقترحة', desc: 'ردود يصوغها الذكاء الاصطناعي يرسلها فريقك بنقرة.' },
        { key: 'translate', title: 'عربي ↔ إنجليزي', desc: 'يفهم ويردّ بطلاقة في كلتا اللغتين.' },
      ],
      panelTitle: 'مساعد الذكاء الاصطناعي',
      suggestionLabel: 'رد مقترح',
      suggestion: 'تم شحن طلبك رقم 2847 وسيصل غدًا قبل الساعة 6 مساءً. هذا رابط التتبّع 📦',
      sentimentLabel: 'المشاعر',
      sentiment: 'إيجابي · جاهز للشراء',
      insertCta: 'إدراج الرد',
      customerMsg: 'مرحبًا! هل طلبي جاهز؟ 😊',
      composerPlaceholder: 'اكتب ردًا…',
    },
    workflow: {
      eyebrow: 'كيف تعمل',
      title: 'من أول رسالة إلى إتمام الصفقة',
      subtitle: 'تدفّق مترابط تُحدّث فيه كل خطوة ما يليها — تلقائيًا.',
      steps: [
        { key: 'customer', title: 'العميل يراسلك', desc: 'يتواصل العميل عبر واتساب — ليلًا أو نهارًا.' },
        { key: 'ai', title: 'رد فوري بالذكاء الاصطناعي', desc: 'يجيب المساعد ويؤهّل ويجمع السياق.' },
        { key: 'team', title: 'الفريق يستلم', desc: 'تُوجَّه المحادثات المهمة للموظف المناسب بكامل السجل.' },
        { key: 'crm', title: 'النظام يبقى متزامنًا', desc: 'تُحدَّث جهات الاتصال والصفقات والملاحظات تلقائيًا.' },
        { key: 'reports', title: 'التقارير تكشف النمو', desc: 'لوحات حية تُظهر ما ينجح وما يستحق التوسّع.' },
      ],
    },
    industries: {
      eyebrow: 'الحلول',
      title: 'مصممة لكل عمل سعودي',
      subtitle: 'من متجر صغير إلى مؤسسة وطنية — تتكيّف المنصة مع طريقة بيعك.',
      items: [
        { key: 'restaurants', label: 'المطاعم والمقاهي' },
        { key: 'clinics', label: 'العيادات والرعاية الصحية' },
        { key: 'realestate', label: 'العقارات' },
        { key: 'retail', label: 'المتاجر والتجزئة' },
        { key: 'ecommerce', label: 'التجارة الإلكترونية' },
        { key: 'education', label: 'التعليم' },
        { key: 'automotive', label: 'السيارات' },
        { key: 'agencies', label: 'وكالات التسويق' },
      ],
    },
    showcase: {
      eyebrow: 'المنتج',
      title: 'مركز قيادة',
      titleGold: 'لكل محادثة',
      subtitle:
        'عرض واتساب حقيقي — فقاعات وعلامات قراءة وتفاعلات وردود وأزرار تفاعلية تمامًا كما يراها عملاؤك. بدون معاينات مكسورة وبدون مفاجآت.',
      bullets: [
        'معاينات رسائل واتساب بدقة كاملة',
        'صندوق وارد متعدد الموظفين مع حضور مباشر',
        'منشئ حملات بالسحب والإفلات',
        'واجهة Meta الرسمية + Baileys مع تبديل تلقائي',
      ],
      url: 'app.nexuscrm.sa/inbox',
    },
    tour: {
      eyebrow: 'جولة في المنتج',
      title: 'ستة أنظمة.',
      titleGold: 'منصة واحدة.',
      subtitle: 'كل شاشة بالأسفل هي المنتج الحقيقي، مأخوذة من التطبيق نفسه — وليست تصميمًا وهميًا.',
      items: [
        {
          key: 'inbox',
          label: 'الصندوق المشترك',
          title: 'رقم واحد. فريقك بالكامل.',
          desc: 'المبيعات والدعم والتصميم يعملون على نفس رقم الواتساب دون أن يرد شخصان على العميل نفسه.',
          bullets: ['توزيع دوري ضمن ساعات العمل', 'ملاحظات داخلية ووسوم وعروض محفوظة', 'سجل العميل كاملًا بجانب كل محادثة'],
        },
        {
          key: 'automation',
          label: 'الأتمتة',
          title: 'أتمت المتابعة.',
          desc: 'مسارات تعمل بالمحفزات تؤهّل العميل وتوجّهه للفريق المناسب وتتابعه لاحقًا — دون أن يتذكر أحد ذلك.',
          bullets: ['محفزات على أحداث حقيقية لا على جداول', 'تفرّع حسب التقييم واللغة وساعات العمل', 'تأخير يُلغى تلقائيًا عند رد العميل'],
        },
        {
          key: 'deals',
          label: 'خط الصفقات',
          title: 'حوّل المحادثات إلى صفقات.',
          desc: 'لوحة بالسحب والإفلات تتابع القيمة حسب المرحلة، لترى أين تتعطل الأموال ومن المسؤول عنها.',
          bullets: ['مراحل تطابق طريقة بيعك فعليًا', 'القيمة ونسبة التحويل تُحتسب تلقائيًا', 'العملاء المؤهّلون بالذكاء الاصطناعي يصلون مُرتّبين'],
        },
        {
          key: 'broadcasts',
          label: 'الحملات',
          title: 'أرسل على نطاق واسع.',
          desc: 'آلاف الرسائل المُقسّمة مع تتبّع التسليم لكل مستلم — وحدود إحماء تحافظ على رقمك.',
          bullets: ['تقسيم حسب الوسم أو المرحلة أو الحقول المخصصة', 'إيقاع إرسال آمن يمنع الحظر', 'التسليم والقراءة والرد لكل حملة'],
        },
        {
          key: 'analytics',
          label: 'التحليلات',
          title: 'قِس كل شيء.',
          desc: 'أزمنة الرد ونسب الحل وأحمال الموظفين ونتائج الحملات وأثر الذكاء الاصطناعي — في شاشة واحدة جاهزة للعرض.',
          bullets: ['زمن أول رد لكل موظف', 'الإيرادات متتبَّعة حتى أول رسالة', 'نسبة المحادثات التي أغلقها الذكاء الاصطناعي وحده'],
        },
      ],
    },
    mobile: {
      eyebrow: 'الجوال',
      title: 'صندوق وارِدك،',
      titleGold: 'في جيبك',
      subtitle: 'ثبّته كتطبيق أصلي. نفس الصندوق ونفس نظام العملاء ونفس الإشعارات — على الجوال الذي يحمله فريقك أصلًا.',
      bullets: [
        'تطبيق ويب قابل للتثبيت — بلا مراجعة متجر',
        'إشعارات فورية للعملاء المهمين وتجاوز زمن الرد',
        'يعمل دون اتصال ويزامن عند العودة',
      ],
    },
    testimonials: {
      eyebrow: 'قصص العملاء',
      title: 'محل ثقة أفضل الفرق السعودية',
      items: [
        { quote: 'انتقلنا من إدارة واتساب على هواتف شخصية إلى توجيه 3000 محادثة يوميًا عبر صندوق وارد واحد. انخفض زمن الرد بنسبة 80%.', author: 'سارة الراشد', role: 'مديرة الدعم، نوفامارت' },
        { quote: 'قوالب الحملات تظهر تمامًا كرسائل واتساب الحقيقية — أخيرًا أداة لا تُحرجنا أمام العملاء.', author: 'خالد الحربي', role: 'مدير النمو، تمكين' },
        { quote: 'يتولّى الذكاء الاصطناعي 70% من الأسئلة الواردة قبل أن يراها موظف. فريقنا الصغير صار يؤدّي كمركز اتصال مؤسسي.', author: 'نورة القحطاني', role: 'الرئيسة التنفيذية، فاست شيب' },
      ],
    },
    pricing: {
      eyebrow: 'الأسعار',
      title: 'أسعار بسيطة وشفافة',
      subtitle: 'ابدأ مجانًا. توسّع عند النمو. بدون رسوم خفية، وإلغاء في أي وقت.',
      perMonth: '/ شهريًا',
      mostPopular: 'الأكثر اختيارًا',
      plans: [
        { key: 'starter', name: 'المبتدئ', price: 'مجاني', sub: 'مجاني للأبد للفرق الصغيرة', features: ['رقم واتساب واحد', 'حتى 500 جهة اتصال', '3 أعضاء فريق', 'أتمتة أساسية', 'دعم المجتمع'], cta: 'ابدأ مجانًا', highlight: false },
        { key: 'pro', name: 'الاحترافي', price: '199 ﷼', sub: 'فوترة شهرية · وفّر 20% سنويًا', features: ['3 أرقام واتساب', 'حتى 10,000 جهة اتصال', 'أعضاء فريق بلا حدود', 'مساعد ذكي + أتمتة متقدمة', 'حملات جماعية', 'دعم ذو أولوية'], cta: 'ابدأ تجربة مجانية', highlight: true },
        { key: 'enterprise', name: 'المؤسسات', price: 'مخصص', sub: 'استضافة ذاتية أو سحابة مُدارة', features: ['أرقام وجهات اتصال بلا حدود', 'خيار العلامة البيضاء', 'تكاملات مخصصة', 'بنية تحتية مخصصة', 'اتفاقية مستوى خدمة + مدير إعداد'], cta: 'تواصل مع المبيعات', highlight: false },
      ],
    },
    faq: {
      eyebrow: 'الأسئلة الشائعة',
      title: 'إجابات لأسئلتك',
      subtitle: 'كل ما تحتاج معرفته قبل أن تبدأ.',
      items: [
        { q: 'هل أحتاج واجهة واتساب للأعمال الرسمية؟', a: 'يمكنك البدء خلال دقائق بمسح رمز QR عبر مزوّد Baileys، أو ربط واجهة Meta الرسمية للحجم الأكبر والقوالب الموثّقة. المنصة تدعم الاثنين — وتبدّل بينهما تلقائيًا.' },
        { q: 'هل يدعم اللغة العربية بالكامل؟', a: 'نعم. المنصة بالكامل والمساعد الذكي وقوالب الرسائل ثنائية اللغة بالكامل مع دعم أصيل للكتابة من اليمين لليسار، مبنية خصيصًا للسوق السعودي.' },
        { q: 'كم يستغرق الإعداد؟', a: 'معظم الشركات تعمل خلال أقل من 10 دقائق — اربط رقمك واستورد جهات الاتصال وابدأ المراسلة. بدون مطوّرين.' },
        { q: 'هل بياناتي آمنة وخاصة؟', a: 'بياناتك مشفّرة أثناء النقل والتخزين، ومستضافة في بنية تحتية متوافقة. خطط المؤسسات يمكن استضافتها ذاتيًا بالكامل على خوادمك.' },
        { q: 'هل يمكنني نقل جهات اتصالي الحالية؟', a: 'بالتأكيد. استورد عبر ملف CSV، أو زامن من نظامك الحالي، أو دع المحادثات تنشئ جهات الاتصال تلقائيًا عند مراسلة العملاء.' },
      ],
    },
    finalCta: {
      title: 'جاهز لتحويل واتساب إلى قناة مبيعاتك الأولى؟',
      subtitle: 'انضم لمئات الشركات السعودية التي تقدّم دعمًا أسرع وحملات أذكى وصفقات أكثر — كل يوم.',
      primary: 'ابدأ مجانًا اليوم',
      secondary: 'تحدّث مع المبيعات',
      reassurance: 'بدون بطاقة ائتمان · الإعداد خلال 10 دقائق · إلغاء في أي وقت',
    },
    footer: {
      tagline: 'نظام واتساب CRM المتميّز للأعمال السعودية الحديثة.',
      columns: [
        { title: 'المنتج', links: ['المميزات', 'المساعد الذكي', 'الأسعار', 'خارطة الطريق'] },
        { title: 'الحلول', links: ['المطاعم', 'الرعاية الصحية', 'العقارات', 'التجارة الإلكترونية'] },
        { title: 'الشركة', links: ['من نحن', 'الخصوصية', 'الشروط', 'تواصل معنا'] },
      ],
      rights: 'جميع الحقوق محفوظة.',
      disclaimer: 'غير تابع لشركة Meta Platforms Inc.',
      badges: ['متوافق مع GDPR', 'جاهزية 99.9%', 'استضافة داخل المنطقة'],
    },
  },
}
