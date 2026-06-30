/**
 * Lightweight i18n for Talkora — no extra deps, no server work.
 *
 * - Stored language is mirrored from `profiles.app_language` (via the
 *   existing onboarding/settings flow) into localStorage so the UI flips
 *   immediately without waiting for a network round-trip.
 * - English is the fallback for any missing key in the active locale.
 * - Strings live in `dictionaries` below. Add a key in `en` first, then
 *   translate into hi/ta/te/bn/mr; missing locales fall back to English.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";

export type Locale =
  | "en" | "hi" | "bn" | "te" | "mr" | "ta"
  | "gu" | "kn" | "ml" | "pa" | "ur" | "or" | "as"
  | "es" | "fr" | "ar";

const STORAGE_KEY = "talkora.lang";

type Dict = Record<string, string>;

const en: Dict = {
  // nav
  "nav.discover": "Discover",
  "nav.chats": "Chats",
  "nav.connect": "Connect",
  "nav.wallet": "Wallet",
  "nav.profile": "Profile",
  "nav.recents": "Recents",
  "nav.inbox": "Inbox",
  "nav.admin": "Admin",
  // common
  "common.loading": "Loading…",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.coins": "coins",
  "common.minutes": "min",
  "common.online": "Online",
  "common.offline": "Offline",
  "common.back": "Back",
  "common.retry": "Try again",
  "common.empty": "Nothing here yet",
  // home
  "home.firstOffer": "First Recharge — up to 50% bonus",
  "home.useNow": "Use now",
  "home.freeMinutesLeft": "{m} free min left",
  "home.tabOnline": "Online",
  "home.tabVideo": "Video",
  "home.tabRooms": "Rooms",
  "home.creatorDashboard": "Creator Dashboard",
  // call
  "call.audio": "Audio call",
  "call.video": "Video call",
  "call.perMin": "{n} coins / min",
  "call.endConfirmTitle": "End this call?",
  "call.endConfirmBody": "Your partner will be disconnected.",
  "call.endYes": "Yes, end call",
  "call.endNo": "Stay",
  "call.gift": "Send gift",
  // wallet
  "wallet.balance": "Wallet balance",
  "wallet.recharge": "Recharge",
  "wallet.withdraw": "Withdraw",
  "wallet.history": "Transaction history",
  // settings
  "settings.title": "Profile & Settings",
  "settings.language": "App language",
  "settings.notifications": "Notifications",
  "settings.blocked": "Blocked users",
  "settings.privacy": "Privacy policy",
  "settings.terms": "Terms",
  "settings.delete": "Delete account",
  "settings.signOut": "Sign out",
  // notifications
  "notif.title": "Notifications",
  "notif.markAll": "Mark all read",
  "notif.empty": "You have no notifications yet.",
  "notif.prefs.chat": "Chat messages",
  "notif.prefs.calls": "Calls",
  "notif.prefs.gifts": "Gifts received",
  "notif.prefs.follows": "New followers",
  "notif.prefs.system": "Account & safety",
  "notif.prefs.marketing": "Offers & promos",
  // wallet
  "wallet.title": "Wallet",
  "wallet.balanceLabel": "Balance",
  "wallet.freeMinsLeft": "{m} free minutes remaining",
  "wallet.rechargeCoins": "Recharge coins",
  "wallet.recentTxn": "Recent transactions",
  "wallet.noTxn": "No transactions yet.",
  // onboarding
  "onb.title": "Set up your profile",
  "onb.subtitle": "A few quick details to get started. You'll get 5 free chat minutes.",
  "onb.username": "Username",
  "onb.usernamePh": "myname",
  "onb.gender": "Gender",
  "onb.female": "Female",
  "onb.male": "Male",
  "onb.other": "Other",
  "onb.dob": "Date of birth",
  "onb.country": "Country",
  "onb.state": "State",
  "onb.statePh": "State / Region",
  "onb.language": "Language",
  "onb.langHint": "You can change this anytime from Profile → App language.",
  "onb.joinCreator": "Join as creator?",
  "onb.joinCreatorHint": "Earn coins from chats. KYC required to withdraw.",
  "onb.guidelines": "I am 18 years or older, and I accept the Community Guidelines: no harassment, nudity, scams, hate, or illegal activity. Violators are banned.",
  "onb.cta": "Create my profile",
  "onb.welcome": "Welcome to Talkora! You got 5 free minutes 🎉",
  "onb.selectPlaceholder": "Select",
  "onb.selectCountry": "Select country",
  "onb.selectState": "Select state",
  // settings extras
  "settings.heading": "Profile",
  "settings.appLang": "App language",
  "settings.appLangHint": "Choose the language you want to see across the app.",
  "settings.selectLang": "Select language",
  "settings.followers": "Followers",
  "settings.following": "Following",
  "settings.coins": "Coins",
  "settings.profileDetails": "Profile details",
  "settings.languageRow": "Language",
  "settings.langUpdated": "Language updated",
};


const hi: Dict = {
  "nav.discover": "खोजें",
  "nav.chats": "चैट",
  "nav.connect": "कनेक्ट",
  "nav.wallet": "वॉलेट",
  "nav.profile": "प्रोफ़ाइल",
  "nav.recents": "हाल का",
  "nav.inbox": "इनबॉक्स",
  "nav.admin": "एडमिन",
  "common.loading": "लोड हो रहा है…",
  "common.save": "सहेजें",
  "common.cancel": "रद्द करें",
  "common.confirm": "पुष्टि करें",
  "common.coins": "सिक्के",
  "common.minutes": "मिनट",
  "common.online": "ऑनलाइन",
  "common.offline": "ऑफ़लाइन",
  "common.back": "वापस",
  "common.retry": "पुनः प्रयास",
  "common.empty": "अभी कुछ नहीं है",
  "home.firstOffer": "पहला रिचार्ज — 50% तक बोनस",
  "home.useNow": "अभी उपयोग करें",
  "home.freeMinutesLeft": "{m} मुफ़्त मिनट शेष",
  "home.tabOnline": "ऑनलाइन",
  "home.tabVideo": "वीडियो",
  "home.tabRooms": "रूम्स",
  "home.creatorDashboard": "क्रिएटर डैशबोर्ड",
  "call.audio": "ऑडियो कॉल",
  "call.video": "वीडियो कॉल",
  "call.perMin": "{n} सिक्के / मिनट",
  "call.endConfirmTitle": "कॉल समाप्त करें?",
  "call.endConfirmBody": "आपका पार्टनर डिस्कनेक्ट हो जाएगा।",
  "call.endYes": "हाँ, समाप्त करें",
  "call.endNo": "रुकें",
  "call.gift": "गिफ्ट भेजें",
  "wallet.balance": "वॉलेट बैलेंस",
  "wallet.recharge": "रिचार्ज",
  "wallet.withdraw": "विदड्रॉ",
  "wallet.history": "लेन-देन इतिहास",
  "settings.title": "प्रोफ़ाइल और सेटिंग्स",
  "settings.language": "ऐप भाषा",
  "settings.notifications": "नोटिफिकेशन",
  "settings.blocked": "ब्लॉक किए गए",
  "settings.privacy": "गोपनीयता नीति",
  "settings.terms": "नियम",
  "settings.delete": "खाता हटाएं",
  "settings.signOut": "साइन आउट",
  "notif.title": "नोटिफिकेशन",
  "notif.markAll": "सभी पढ़े के रूप में",
  "notif.empty": "कोई नोटिफिकेशन नहीं है।",
  "notif.prefs.chat": "चैट संदेश",
  "notif.prefs.calls": "कॉल",
  "notif.prefs.gifts": "मिले गिफ्ट",
  "notif.prefs.follows": "नए फॉलोअर्स",
  "notif.prefs.system": "खाता और सुरक्षा",
  "notif.prefs.marketing": "ऑफ़र और प्रचार",
  "wallet.title": "वॉलेट",
  "wallet.balanceLabel": "बैलेंस",
  "wallet.freeMinsLeft": "{m} मुफ़्त मिनट शेष",
  "wallet.rechargeCoins": "सिक्के रिचार्ज करें",
  "wallet.recentTxn": "हाल के लेन-देन",
  "wallet.noTxn": "अभी कोई लेन-देन नहीं।",
  "onb.title": "अपनी प्रोफ़ाइल सेट करें",
  "onb.subtitle": "शुरू करने के लिए कुछ जानकारी दें। आपको 5 मुफ़्त चैट मिनट मिलेंगे।",
  "onb.username": "यूज़रनेम",
  "onb.usernamePh": "मेरा नाम",
  "onb.gender": "लिंग",
  "onb.female": "महिला",
  "onb.male": "पुरुष",
  "onb.other": "अन्य",
  "onb.dob": "जन्म तिथि",
  "onb.country": "देश",
  "onb.state": "राज्य",
  "onb.statePh": "राज्य / क्षेत्र",
  "onb.language": "भाषा",
  "onb.langHint": "आप इसे कभी भी प्रोफ़ाइल → ऐप भाषा से बदल सकते हैं।",
  "onb.joinCreator": "क्रिएटर के रूप में जुड़ें?",
  "onb.joinCreatorHint": "चैट से कमाएँ। विदड्रॉ के लिए KYC ज़रूरी है।",
  "onb.guidelines": "मैं 18 वर्ष या उससे अधिक हूँ, और मैं Community Guidelines स्वीकार करता/करती हूँ: कोई उत्पीड़न, नग्नता, धोखाधड़ी, घृणा, या अवैध गतिविधि नहीं। उल्लंघन करने पर खाता बैन कर दिया जाएगा।",
  "onb.cta": "मेरी प्रोफ़ाइल बनाएँ",
  "onb.welcome": "Talkora में आपका स्वागत है! आपको 5 मुफ़्त मिनट मिले 🎉",
  "onb.selectPlaceholder": "चुनें",
  "onb.selectCountry": "देश चुनें",
  "onb.selectState": "राज्य चुनें",
  "settings.heading": "प्रोफ़ाइल",
  "settings.appLang": "ऐप भाषा",
  "settings.appLangHint": "वह भाषा चुनें जो आप पूरे ऐप में देखना चाहते हैं।",
  "settings.selectLang": "भाषा चुनें",
  "settings.followers": "फ़ॉलोअर्स",
  "settings.following": "फ़ॉलोइंग",
  "settings.coins": "सिक्के",
  "settings.profileDetails": "प्रोफ़ाइल जानकारी",
  "settings.languageRow": "भाषा",
  "settings.langUpdated": "भाषा अपडेट हो गई",
};

const ta: Dict = {
  "nav.discover": "கண்டறி",
  "nav.chats": "அரட்டை",
  "nav.connect": "இணை",
  "nav.wallet": "பணப்பை",
  "nav.profile": "சுயவிவரம்",
  "common.loading": "ஏற்றுகிறது…",
  "common.save": "சேமி",
  "common.cancel": "ரத்து",
  "common.coins": "நாணயங்கள்",
  "common.minutes": "நிமி",
  "home.useNow": "இப்போதே பயன்படுத்து",
  "home.freeMinutesLeft": "{m} இலவச நிமி மீதம்",
  "call.audio": "ஆடியோ அழைப்பு",
  "call.video": "வீடியோ அழைப்பு",
  "call.endConfirmTitle": "அழைப்பை முடிக்கவா?",
  "call.endYes": "ஆம், முடி",
  "call.endNo": "தங்கு",
  "settings.language": "செயலி மொழி",
  "settings.notifications": "அறிவிப்புகள்",
};

const te: Dict = {
  "nav.discover": "కనుగొను",
  "nav.chats": "చాట్‌లు",
  "nav.connect": "కనెక్ట్",
  "nav.wallet": "వాలెట్",
  "nav.profile": "ప్రొఫైల్",
  "common.loading": "లోడ్ అవుతోంది…",
  "common.save": "సేవ్",
  "common.cancel": "రద్దు",
  "common.coins": "నాణేలు",
  "common.minutes": "నిమి",
  "home.useNow": "ఇప్పుడే వాడు",
  "home.freeMinutesLeft": "{m} ఉచిత నిమి మిగిలి",
  "call.audio": "ఆడియో కాల్",
  "call.video": "వీడియో కాల్",
  "call.endConfirmTitle": "కాల్‌ ముగించాలా?",
  "call.endYes": "అవును",
  "call.endNo": "ఆగు",
  "settings.language": "యాప్ భాష",
  "settings.notifications": "నోటిఫికేషన్లు",
};

const bn: Dict = {
  "nav.discover": "খুঁজুন",
  "nav.chats": "চ্যাট",
  "nav.connect": "কানেক্ট",
  "nav.wallet": "ওয়ালেট",
  "nav.profile": "প্রোফাইল",
  "common.loading": "লোড হচ্ছে…",
  "common.save": "সংরক্ষণ",
  "common.cancel": "বাতিল",
  "common.coins": "কয়েন",
  "common.minutes": "মিনিট",
  "home.useNow": "এখনই ব্যবহার",
  "home.freeMinutesLeft": "{m} ফ্রি মিনিট বাকি",
  "call.audio": "অডিও কল",
  "call.video": "ভিডিও কল",
  "call.endConfirmTitle": "কল শেষ করবেন?",
  "call.endYes": "হ্যাঁ",
  "call.endNo": "থামুন",
  "settings.language": "অ্যাপ ভাষা",
  "settings.notifications": "নোটিফিকেশন",
};

const mr: Dict = {
  "nav.discover": "शोधा",
  "nav.chats": "चॅट",
  "nav.connect": "कनेक्ट",
  "nav.wallet": "वॉलेट",
  "nav.profile": "प्रोफाइल",
  "common.loading": "लोड होत आहे…",
  "common.save": "जतन करा",
  "common.cancel": "रद्द",
  "common.coins": "नाणी",
  "common.minutes": "मिनिटे",
  "home.useNow": "आत्ता वापरा",
  "home.freeMinutesLeft": "{m} मोफत मिनिटे शिल्लक",
  "call.audio": "ऑडिओ कॉल",
  "call.video": "व्हिडिओ कॉल",
  "call.endConfirmTitle": "कॉल संपवायचा?",
  "call.endYes": "होय",
  "call.endNo": "थांबा",
  "settings.language": "ॲप भाषा",
  "settings.notifications": "सूचना",
};

const dictionaries: Partial<Record<Locale, Dict>> = { en, hi, ta, te, bn, mr };

function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<Ctx>({
  locale: "en",
  setLocale: () => {},
  t: (k) => k,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  const applyLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof document !== "undefined") document.documentElement.lang = l;
  }, []);

  // Hydrate from localStorage on mount (avoid SSR mismatch by reading after render).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && dictionaries[stored]) applyLocale(stored);
  }, [applyLocale]);

  // After login, pull `profiles.language` so the user's saved preference
  // wins over the localStorage default — including on a fresh device.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    async function hydrateFromProfile(userId: string) {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data } = await supabase
          .from("profiles")
          .select("language")
          .eq("id", userId)
          .maybeSingle();
        if (cancelled) return;
        const lang = (data?.language ?? null) as Locale | null;
        if (lang && dictionaries[lang]) {
          window.localStorage.setItem(STORAGE_KEY, lang);
          applyLocale(lang);
        }
      } catch {
        /* non-fatal: keep current locale */
      }
    }

    (async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (uid) hydrateFromProfile(uid);

      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" || event === "USER_UPDATED") {
          if (session?.user?.id) hydrateFromProfile(session.user.id);
        }
      });
      // Stash unsubscribe on cleanup
      cleanup = () => sub.subscription.unsubscribe();
    })();

    let cleanup: (() => void) | null = null;
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [applyLocale]);

  const setLocale = useCallback((l: Locale) => {
    applyLocale(l);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, l);
  }, [applyLocale]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const d = dictionaries[locale] ?? en;
      const str = d[key] ?? en[key] ?? key;
      return format(str, vars);
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}

/** Persist a profile language change into localStorage so UI flips immediately. */
export function syncStoredLocale(language: string | null | undefined) {
  if (typeof window === "undefined" || !language) return;
  if (!(language in dictionaries)) return;
  window.localStorage.setItem(STORAGE_KEY, language);
}
