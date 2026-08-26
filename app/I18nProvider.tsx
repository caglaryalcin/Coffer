"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const COFFER_LANGUAGE_STORAGE_KEY = "coffer:language:v1";

export const languages = [
  { code: "en", label: "English", nativeLabel: "English", flag: "🇬🇧" },
  { code: "tr", label: "Turkish", nativeLabel: "Türkçe", flag: "🇹🇷" },
  { code: "de", label: "German", nativeLabel: "Deutsch", flag: "🇩🇪" },
] as const;

export type CofferLanguage = (typeof languages)[number]["code"];

type TranslationDictionary = Record<string, string>;
type TranslationPattern = {
  pattern: RegExp;
  replace: (...matches: string[]) => string;
};

type I18nContextValue = {
  language: CofferLanguage;
  setLanguage: (language: CofferLanguage) => void;
  translate: (text: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const languageCodes = new Set<CofferLanguage>(languages.map((language) => language.code));

function isLanguage(value: string | null | undefined): value is CofferLanguage {
  return Boolean(value && languageCodes.has(value as CofferLanguage));
}

function readStoredLanguage(): CofferLanguage {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(COFFER_LANGUAGE_STORAGE_KEY);
    return isLanguage(stored) ? stored : "en";
  } catch {
    return "en";
  }
}

function writeStoredLanguage(language: CofferLanguage) {
  try {
    window.localStorage.setItem(COFFER_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Language switching still works for the current session.
  }
}

const tr: TranslationDictionary = {
  ".2fas or JSON, up to 5 MiB": ".2fas veya JSON, en fazla 5 MiB",
  ".coffer or JSON, up to 5 MiB": ".coffer veya JSON, en fazla 5 MiB",
  "2FAS backup password": "2FAS yedek parolası",
  "2FAS backup passphrase": "2FAS yedek parolası",
  "2FAS backup passphrases do not match.": "2FAS yedek parolaları eşleşmiyor.",
  "2FAS COMPATIBLE": "2FAS UYUMLU",
  "2FAS mobile backup": "2FAS mobil yedeği",
  "2fas integrated import": "2fas entegre içe aktarım",
  "2fauth integrated import": "2fauth entegre içe aktarım",
  "2FAuth JSON, up to 5 MiB": "2FAuth JSON, en fazla 5 MiB",
  "Add to Favorites": "Favorilere ekle",
  "Amber": "Kehribar",
  "Anyone with this file can generate your verification codes.": "Bu dosyaya sahip olan herkes doğrulama kodlarını üretebilir.",
  "Apply one logo choice to selected accounts.": "Tek bir logo seçimini seçili hesaplara uygula.",
  "At least 12 characters": "En az 12 karakter",
  "Author:": "Yazar:",
  "Best-effort removal after 30 seconds if the clipboard still contains that code.": "Pano hala bu kodu içeriyorsa 30 saniye sonra temizlenir.",
  "Blue": "Mavi",
  "Briefcase": "Evrak çantası",
  "Camera scanner active.": "Kamera tarayıcısı aktif.",
  "Change your vault password and control when the vault locks and how the clipboard behaves.": "Kasa parolanı değiştir; kasanın ne zaman kilitleneceğini ve panonun nasıl davranacağını ayarla.",
  "Check before adding": "Eklemeden önce kontrol et",
  "Choose a new password that is different from your current password.": "Mevcut parolandan farklı yeni bir parola seç.",
  "Choose a unique password that you do not use for another service.": "Başka bir serviste kullanmadığın benzersiz bir parola seç.",
  "Coffer backup": "Coffer yedeği",
  "Coffer cannot reset it or decrypt your vault without it.": "Coffer bunu sıfırlayamaz veya onsuz kasanın şifresini çözemez.",
  "Coffer cannot reset it or decrypt your vault without it. Store it somewhere safe.": "Coffer bunu sıfırlayamaz veya onsuz kasanın şifresini çözemez. Güvenli bir yerde sakla.",
  "Coffer could not change your password. Please try again.": "Coffer parolanı değiştiremedi. Lütfen tekrar dene.",
  "Coffer could not create your account. Please try again.": "Coffer hesabını oluşturamadı. Lütfen tekrar dene.",
  "Coffer could not delete this account. Please try again.": "Coffer bu hesabı silemedi. Lütfen tekrar dene.",
  "Coffer could not generate a test code. Check the secret and TOTP settings, then try again.": "Coffer test kodu üretemedi. Gizli anahtarı ve TOTP ayarlarını kontrol edip tekrar dene.",
  "Coffer could not remove the profile photo. Please try again.": "Coffer profil fotoğrafını kaldıramadı. Lütfen tekrar dene.",
  "Coffer could not save the profile photo. Please try again.": "Coffer profil fotoğrafını kaydedemedi. Lütfen tekrar dene.",
  "Coffer could not sign you in. Check your details and try again.": "Coffer giriş yapamadı. Bilgilerini kontrol edip tekrar dene.",
  "Coffer could not update your profile. Please try again.": "Coffer profilini güncelleyemedi. Lütfen tekrar dene.",
  "Coffer is a multi-user, self-hosted authenticator vault for encrypted TOTP accounts, QR imports, local service logos, groups, and portable backups.": "Coffer; şifreli TOTP hesapları, QR içe aktarımları, yerel servis logoları, gruplar ve taşınabilir yedekler için çok kullanıcılı, self-hosted bir doğrulayıcı kasasıdır.",
  "Color": "Renk",
  "Confirm that you understand this file contains unencrypted secrets.": "Bu dosyanın şifrelenmemiş sırlar içerdiğini anladığını onayla.",
  "Confirm your password.": "Parolanı onayla.",
  "Create a .2fas file for the mobile app. Account secrets are password-protected; 2FAS metadata and group names may remain readable. Archived accounts and custom logos are excluded.": "Mobil uygulama için bir .2fas dosyası oluştur. Hesap sırları parolayla korunur; 2FAS meta verileri ve grup adları okunabilir kalabilir. Arşivlenmiş hesaplar ve özel logolar hariç tutulur.",
  "Create a complete backup containing accounts, groups, favorites, custom logos, and TOTP settings. Add a passphrase for protection, or leave both fields blank.": "Hesapları, grupları, favorileri, özel logoları ve TOTP ayarlarını içeren eksiksiz bir yedek oluştur. Koruma için parola ekle veya iki alanı da boş bırak.",
  "Create Coffer account": "Coffer hesabı oluştur",
  "Data & backup": "Veri ve yedekleme",
  "Delete this empty group? This cannot be undone. Accounts are never deleted with a group.": "Bu boş grup silinsin mi? Bu işlem geri alınamaz. Hesaplar hiçbir zaman grupla birlikte silinmez.",
  "Display name cannot contain control characters.": "Görünen ad kontrol karakterleri içeremez.",
  "Dot": "Nokta",
  "Emerald": "Zümrüt",
  "Encrypted in this browser before the vault is saved.": "Kasa kaydedilmeden önce bu tarayıcıda şifrelenir.",
  "Encrypted vault data is persisted on your self-hosted server and remains available after refresh.": "Şifreli kasa verisi self-hosted sunucunda saklanır ve yenilemeden sonra kullanılabilir kalır.",
  "Enter a group name.": "Grup adı gir.",
  "Enter a valid email address.": "Geçerli bir e-posta adresi gir.",
  "Enter the name you want Coffer to display.": "Coffer'da görünmesini istediğin adı gir.",
  "Enter your current password.": "Mevcut parolanı gir.",
  "Enter your current password to delete this account.": "Bu hesabı silmek için mevcut parolanı gir.",
  "Enter your email address.": "E-posta adresini gir.",
  "Enter your password.": "Parolanı gir.",
  "Enter your sign-in email exactly to confirm account deletion.": "Hesap silmeyi onaylamak için giriş e-postanı aynen gir.",
  "Exported backup files, Kubernetes volume snapshots, and host backups are not removed.": "Dışa aktarılan yedek dosyaları, Kubernetes volume snapshot'ları ve host yedekleri kaldırılmaz.",
  "Finance": "Finans",
  "Folder": "Klasör",
  "Generate a code locally from this unsaved secret.": "Kaydedilmemiş bu sırdan yerel olarak bir kod üret.",
  "Generated locally from the unsaved secret. Nothing was saved. Compare it with the service before saving.": "Kaydedilmemiş sırdan yerel olarak üretildi. Hiçbir şey kaydedilmedi. Kaydetmeden önce servisle karşılaştır.",
  "Generating a test code locally…": "Yerel olarak test kodu üretiliyor…",
  "Group names can be at most 48 characters.": "Grup adları en fazla 48 karakter olabilir.",
  "Group names cannot contain control characters.": "Grup adları kontrol karakterleri içeremez.",
  "Health": "Sağlık",
  "Help and issues": "Yardım ve sorunlar",
  "Home": "Ev",
  "Import a .2fas file from 2FAS and review every account before adding it.": "2FAS'tan bir .2fas dosyası içe aktar ve eklemeden önce her hesabı incele.",
  "Import a schema 1 JSON file from 2FAuth and review every account before adding it.": "2FAuth'tan schema 1 JSON dosyası içe aktar ve eklemeden önce her hesabı incele.",
  "Interoperable text file · .txt": "Uyumlu metin dosyası · .txt",
  "Invalid": "Geçersiz",
  "Keep both": "İkisini de tut",
  "Keep this browser's changes": "Bu tarayıcının değişikliklerini tut",
  "Leave blank or use 12+ characters": "Boş bırak veya 12+ karakter kullan",
  "Leave this blank only if the 2FAS backup was exported without a password.": "Bunu yalnızca 2FAS yedeği parolasız dışa aktarıldıysa boş bırak.",
  "Lime": "Limon yeşili",
  "Live camera preview for QR scanning": "QR taraması için canlı kamera önizlemesi",
  "Looking for a TOTP setup code…": "TOTP kurulum kodu aranıyor…",
  "Match each service": "Her servisi eşleştir",
  "Name this empty group and choose how it appears in the sidebar.": "Bu boş grubu adlandır ve kenar çubuğunda nasıl görüneceğini seç.",
  "Never": "Asla",
  "No accounts were found in this file.": "Bu dosyada hesap bulunamadı.",
  "Open a new Coffer issue on GitHub in a new tab": "GitHub'da yeni sekmede yeni Coffer issue'su aç",
  "Open the Coffer repository on GitHub in a new tab": "Coffer deposunu GitHub'da yeni sekmede aç",
  "OTPAuth link list": "OTPAuth bağlantı listesi",
  "OTPAuth URI list": "OTPAuth URI listesi",
  "Password changed.": "Parola değiştirildi.",
  "Passphrases do not match.": "Parolalar eşleşmiyor.",
  "Permanently remove this user and its encrypted vault from Coffer server storage.": "Bu kullanıcıyı ve şifreli kasasını Coffer sunucu depolamasından kalıcı olarak kaldır.",
  "Person": "Kişi",
  "Personal": "Kişisel",
  "PNG, JPEG, or WebP · maximum 10 MiB · processed locally": "PNG, JPEG veya WebP · en fazla 10 MiB · yerel olarak işlenir",
  "PNG, JPEG, or WebP. Photos are cropped to a square and stored inside your encrypted vault.": "PNG, JPEG veya WebP. Fotoğraflar kare olarak kırpılır ve şifreli kasanın içinde saklanır.",
  "PNG, JPEG, or WebP up to 5 MB. Fitted to 128 × 128 and safely checked against the encrypted vault's logo limit.": "5 MB'a kadar PNG, JPEG veya WebP. 128 × 128'e sığdırılır ve şifreli kasanın logo limitine karşı güvenle kontrol edilir.",
  "Profile photo removed.": "Profil fotoğrafı kaldırıldı.",
  "Profile photo updated.": "Profil fotoğrafı güncellendi.",
  "Profile updated.": "Profil güncellendi.",
  "Processing logo…": "Logo işleniyor…",
  "Readable complete backup · .json": "Okunabilir tam yedek · .json",
  "Recommended": "Önerilen",
  "Reload this page after the vault server is available.": "Kasa sunucusu kullanılabilir olduğunda bu sayfayı yeniden yükle.",
  "Rename this group and choose how it appears in the sidebar.": "Bu grubu yeniden adlandır ve kenar çubuğunda nasıl görüneceğini seç.",
  "Restore accounts, groups, favorites, and TOTP settings from a Coffer backup, with or without a passphrase.": "Coffer yedeğinden hesapları, grupları, favorileri ve TOTP ayarlarını parolalı veya parolasız geri yükle.",
  "Resolving…": "Çözümleniyor…",
  "Rose": "Gül",
  "Secrets stay hidden during review and are encrypted before they are saved.": "Sırlar inceleme sırasında gizli kalır ve kaydedilmeden önce şifrelenir.",
  "Securing pending encrypted changes and clearing this browser session…": "Bekleyen şifreli değişiklikler güvenceye alınıyor ve bu tarayıcı oturumu temizleniyor…",
  "Shield": "Kalkan",
  "Shopping": "Alışveriş",
  "Sky": "Gök mavisi",
  "Slate": "Arduvaz",
  "Social": "Sosyal",
  "Stack:": "Teknoloji:",
  "Star": "Yıldız",
  "Suggested logos are based on the selected accounts' shared platform. Choose one or keep automatic matching.": "Önerilen logolar seçili hesapların ortak platformuna göre belirlenir. Birini seç veya otomatik eşleştirmeyi koru.",
  "The downloaded file will contain readable authentication secrets.": "İndirilen dosya okunabilir doğrulama sırları içerir.",
  "The generated code expired before it could be shown.": "Üretilen kod gösterilmeden önce süresi doldu.",
  "The group could not be deleted.": "Grup silinemedi.",
  "The group could not be saved.": "Grup kaydedilemedi.",
  "The group could not be saved. Check the name and try again.": "Grup kaydedilemedi. Adı kontrol edip tekrar dene.",
  "The new passwords do not match.": "Yeni parolalar eşleşmiyor.",
  "The passwords do not match.": "Parolalar eşleşmiyor.",
  "The profile could not be updated while the vault is unavailable.": "Kasa kullanılamıyorken profil güncellenemez.",
  "The profile photo could not be removed while the vault is unavailable.": "Kasa kullanılamıyorken profil fotoğrafı kaldırılamaz.",
  "The profile photo could not be saved while the vault is unavailable.": "Kasa kullanılamıyorken profil fotoğrafı kaydedilemez.",
  "The selected accounts could not be updated.": "Seçili hesaplar güncellenemedi.",
  "The selected image could not be processed.": "Seçili görsel işlenemedi.",
  "The selected image could not be scanned. Try a PNG, JPEG, or WebP image with a clear QR code.": "Seçili görsel taranamadı. Net QR kodu olan bir PNG, JPEG veya WebP görseli dene.",
  "The selected logo could not be processed.": "Seçili logo işlenemedi.",
  "This cannot be undone after the file is downloaded.": "Dosya indirildikten sonra bu işlem geri alınamaz.",
  "This does not look like a Coffer backup.": "Bu bir Coffer yedeği gibi görünmüyor.",
  "This file is larger than the 5 MiB import limit.": "Bu dosya 5 MiB içe aktarma limitinden büyük.",
  "Travel": "Seyahat",
  "Unencrypted export downloaded.": "Şifrelenmemiş dışa aktarım indirildi.",
  "Unlock your vault before creating a backup.": "Yedek oluşturmadan önce kasanın kilidini aç.",
  "Uploaded logo ready for the selected accounts.": "Yüklenen logo seçili hesaplar için hazır.",
  "Use 12+ printable ASCII characters for iOS and Android compatibility. 2FAS cannot recover this passphrase.": "iOS ve Android uyumluluğu için 12+ yazdırılabilir ASCII karakter kullan. 2FAS bu parolayı kurtaramaz.",
  "Use only printable ASCII characters in the 2FAS passphrase for iOS and Android compatibility.": "iOS ve Android uyumluluğu için 2FAS parolasında yalnızca yazdırılabilir ASCII karakterler kullan.",
  "Violet": "Mor",
  "We could not create the 2FAS mobile backup.": "2FAS mobil yedeği oluşturulamadı.",
  "We could not create the Coffer backup.": "Coffer yedeği oluşturulamadı.",
  "We could not read this file. It may be damaged or incomplete.": "Bu dosya okunamadı. Hasarlı veya eksik olabilir.",
  "When enabled, switching tabs or minimizing the browser locks the vault immediately, regardless of the automatic lock delay.": "Etkin olduğunda sekme değiştirmek veya tarayıcıyı küçültmek, otomatik kilit gecikmesinden bağımsız olarak kasayı hemen kilitler.",
  "Without a passphrase, anyone with this file can read your authentication secrets. Coffer cannot recover a forgotten passphrase.": "Parola olmadan bu dosyaya sahip herkes doğrulama sırlarını okuyabilir. Coffer unutulan parolayı kurtaramaz.",
  "Work": "İş",
  "Your authentication secrets will be readable without a password.": "Doğrulama sırların parola olmadan okunabilir olacak.",
  "About": "Hakkında",
  "About Archive": "Arşiv hakkında",
  "About Coffer": "Coffer hakkında",
  "Account access": "Hesap erişimi",
  "Account input method": "Hesap giriş yöntemi",
  "Account name": "Hesap adı",
  "Account selection actions": "Hesap seçim işlemleri",
  "ACCOUNT DETAILS": "HESAP DETAYLARI",
  "ACCOUNT LOGOS": "HESAP LOGOLARI",
  "Add account": "Hesap ekle",
  "Add a new account": "Yeni hesap ekle",
  "Add a new authenticator account": "Yeni doğrulayıcı hesabı ekle",
  "Add a service and account name.": "Servis ve hesap adı ekle.",
  "All codes": "Tüm kodlar",
  "All codes is now the default main screen.": "Tüm kodlar artık varsayılan ana ekran.",
  "All codes options": "Tüm kodlar seçenekleri",
  "All visible selected": "Görünenlerin tümü seçildi",
  "Apply": "Uygula",
  "Applying…": "Uygulanıyor…",
  "Archive": "Arşiv",
  "Archive is empty": "Arşiv boş",
  "Archived": "Arşivlendi",
  "Archived account selection actions": "Arşivlenmiş hesap seçim işlemleri",
  "Archived accounts stay encrypted and keep generating codes until you restore them.": "Arşivlenmiş hesaplar şifreli kalır ve geri yükleyene kadar kod üretmeye devam eder.",
  "Automatic": "Otomatik",
  "Automatic lock": "Otomatik kilit",
  "Automatic lock delay": "Otomatik kilit gecikmesi",
  "Automatic matching keeps each account linked to its own service name.": "Otomatik eşleştirme her hesabı kendi servis adıyla eşleştirir.",
  "Back to all codes": "Tüm kodlara dön",
  "Backup passphrase (if used)": "Yedek parolası (kullanıldıysa)",
  "Backup passphrase (optional)": "Yedek parolası (isteğe bağlı)",
  "Balanced cards": "Dengeli kartlar",
  "Base32 secret": "Base32 sırrı",
  "Browser-encrypted vault": "Tarayıcıda şifrelenen kasa",
  "Cancel": "İptal",
  "Card view": "Kart görünümü",
  "Change file": "Dosyayı değiştir",
  "Change password": "Parolayı değiştir",
  "Change photo": "Fotoğrafı değiştir",
  "Change selected logos": "Seçili logoları değiştir",
  "Changing password…": "Parola değiştiriliyor…",
  "Checking accounts…": "Hesaplar kontrol ediliyor…",
  "Checking QR scanner support…": "QR tarayıcı desteği kontrol ediliyor…",
  "Checking your encrypted vault session…": "Şifreli kasa oturumun kontrol ediliyor…",
  "Choose a group": "Grup seç",
  "Choose file": "Dosya seç",
  "Choose the interface language.": "Arayüz dilini seç.",
  "Choose photo": "Fotoğraf seç",
  "Choose platform logo": "Platform logosu seç",
  "Choose which encrypted vault version to keep": "Hangi şifreli kasa sürümünün tutulacağını seç",
  "Clear copied codes": "Kopyalanan kodları temizle",
  "Clear search": "Aramayı temizle",
  "Clear selection": "Seçimi temizle",
  "Close account editor": "Hesap düzenleyiciyi kapat",
  "Close add account dialog": "Hesap ekleme penceresini kapat",
  "Close bulk logo picker": "Toplu logo seçiciyi kapat",
  "Close group customization": "Grup özelleştirmeyi kapat",
  "Colored letter tile": "Renkli harf kutucuğu",
  "Compact": "Kompakt",
  "Condensed horizontal cards": "Sıkıştırılmış yatay kartlar",
  "Confirm delete": "Silmeyi onayla",
  "Confirm new password": "Yeni parolayı onayla",
  "Confirm passphrase": "Parolayı onayla",
  "Confirm password": "Parolayı onayla",
  "Create 2fas export": "2FAS dışa aktarımı oluştur",
  "Create account": "Hesap oluştur",
  "Create an encrypted vault": "Şifreli kasa oluştur",
  "Create export without a passphrase?": "Parolasız dışa aktarma oluşturulsun mu?",
  "Create group": "Grup oluştur",
  "Create protected backup": "Korumalı yedek oluştur",
  "Create unprotected export": "Korumasız dışa aktarım oluştur",
  "Create & move": "Oluştur ve taşı",
  "Creating 2fas export…": "2FAS dışa aktarımı oluşturuluyor…",
  "Creating account…": "Hesap oluşturuluyor…",
  "Creating export…": "Dışa aktarım oluşturuluyor…",
  "Creating your 2fas export…": "2FAS dışa aktarımın oluşturuluyor…",
  "Creating your Coffer export…": "Coffer dışa aktarımın oluşturuluyor…",
  "Current": "Geçerli",
  "Current password": "Mevcut parola",
  "Custom logo": "Özel logo",
  "Customize group": "Grubu özelleştir",
  "Dangerous": "Tehlikeli",
  "Data and backup": "Veri ve yedekleme",
  "Default": "Varsayılan",
  "Default main screen": "Varsayılan ana ekran",
  "Delete account": "Hesabı sil",
  "Delete account permanently": "Hesabı kalıcı olarak sil",
  "Delete group": "Grubu sil",
  "Delete permanently": "Kalıcı olarak sil",
  "Delete selected": "Seçili olanları sil",
  "Delete this account": "Bu hesabı sil",
  "Deleting account…": "Hesap siliniyor…",
  "Deleting…": "Siliniyor…",
  "Digits": "Hane",
  "Display name": "Görünen ad",
  "Do not ask for login information on this browser for 30 days.": "Bu tarayıcıda 30 gün boyunca giriş bilgisi isteme.",
  "Done": "Bitti",
  "Download unprotected export": "Korumasız dışa aktarımı indir",
  "Drop a file here": "Dosyayı buraya bırak",
  "Edit": "Düzenle",
  "Edit account": "Hesabı düzenle",
  "Email": "E-posta",
  "Encrypted in your browser": "Tarayıcıda şifrelenir",
  "Encrypted vault saved": "Şifreli kasa kaydedildi",
  "Enter a different valid Base32 secret to enable Test.": "Testi etkinleştirmek için farklı ve geçerli bir Base32 sırrı gir.",
  "Enter one link per line. Blank lines are ignored.": "Her satıra bir bağlantı gir. Boş satırlar yok sayılır.",
  "Enter the same password again.": "Aynı parolayı tekrar gir.",
  "Existing group": "Mevcut grup",
  "Export": "Dışa aktar",
  "Export anyway": "Yine de dışa aktar",
  "Export readable secrets?": "Okunabilir sırlar dışa aktarılsın mı?",
  "Export unencrypted file": "Şifrelenmemiş dosyayı dışa aktar",
  "Favorites": "Favoriler",
  "Files are processed in this browser. Approved imports are encrypted before storage.": "Dosyalar bu tarayıcıda işlenir. Onaylanan içe aktarmalar kaydedilmeden önce şifrelenir.",
  "GitHub repository": "GitHub deposu",
  "Go back": "Geri dön",
  "Go to default main screen": "Varsayılan ana ekrana git",
  "Grid": "Izgara",
  "Group": "Grup",
  "Group name": "Grup adı",
  "GROUP DETAILS": "GRUP DETAYLARI",
  "Groups": "Gruplar",
  "Hidden, not deleted": "Gizli, silinmiş değil",
  "Hide": "Gizle",
  "I only have the secret key": "Sadece gizli anahtarım var",
  "Icon": "İkon",
  "Import": "İçe aktar",
  "Import another file": "Başka dosya içe aktar",
  "Import QR code": "QR kodu içe aktar",
  "Important": "Önemli",
  "Initials": "Baş harfler",
  "Language": "Dil",
  "Lock and sign out": "Kilitle ve çıkış yap",
  "Lock immediately when Coffer is hidden": "Coffer gizlenince hemen kilitle",
  "Lock vault": "Kasayı kilitle",
  "Lock vault now": "Kasayı şimdi kilitle",
  "Locking your vault": "Kasan kilitleniyor",
  "Manual entry": "Elle giriş",
  "More cards per row": "Satır başına daha fazla kart",
  "Move": "Taşı",
  "Move selected accounts": "Seçili hesapları taşı",
  "Move to Archive": "Arşive taşı",
  "Move to group": "Gruba taşı",
  "NEW AUTHENTICATOR": "YENİ DOĞRULAYICI",
  "NEW GROUP": "YENİ GRUP",
  "New": "Yeni",
  "New group": "Yeni grup",
  "New password": "Yeni parola",
  "Next": "Sonraki",
  "No archived accounts found": "Arşivlenmiş hesap bulunamadı",
  "No catalog logos match. Automatic matching remains selected.": "Eşleşen katalog logosu yok. Otomatik eşleştirme seçili kalır.",
  "No codes found": "Kod bulunamadı",
  "No groups yet": "Henüz grup yok",
  "Open About settings": "Hakkında ayarlarını aç",
  "Open data & backup": "Veri ve yedeklemeyi aç",
  "Opening Coffer": "Coffer açılıyor",
  "or upload a text file": "veya metin dosyası yükle",
  "OTPAuth links": "OTPAuth bağlantıları",
  "Password": "Parola",
  "Paste your setup link": "Kurulum bağlantını yapıştır",
  "Period": "Süre",
  "Plain Coffer JSON": "Düz Coffer JSON",
  "Plain UTF-8 text, up to 5 MiB": "Düz UTF-8 metin, en fazla 5 MiB",
  "Platform logo": "Platform logosu",
  "Plaintext export": "Düz metin dışa aktarımı",
  "Profile": "Profil",
  "Profile photo": "Profil fotoğrafı",
  "Read and write Coffer in your preferred language. This setting stays in this browser and updates the interface immediately.": "Coffer'ı tercih ettiğin dilde kullan. Bu ayar bu tarayıcıda kalır ve arayüzü anında günceller.",
  "Reading and checking accounts…": "Hesaplar okunuyor ve kontrol ediliyor…",
  "Ready to review": "İncelemeye hazır",
  "RECOMMENDED": "ÖNERİLEN",
  "Remember this browser": "Bu tarayıcıyı hatırla",
  "Remove": "Kaldır",
  "Remove from Favorites": "Favorilerden kaldır",
  "Remove upload": "Yüklemeyi kaldır",
  "Replace and import": "Değiştir ve içe aktar",
  "Replace existing": "Mevcut olanı değiştir",
  "Replace logo": "Logoyu değiştir",
  "Repeat it if used": "Kullanıldıysa tekrar gir",
  "Repeat your passphrase": "Parolanı tekrar gir",
  "Restore all codes": "Tüm kodları geri yükle",
  "Restore selected": "Seçili olanları geri yükle",
  "Review accounts": "Hesapları incele",
  "Review account": "Hesabı incele",
  "REVIEW IMPORT": "İÇE AKTARMAYI İNCELE",
  "Save changes": "Değişiklikleri kaydet",
  "Save conflict": "Kayıt çakışması",
  "Save failed · Retry": "Kayıt başarısız · Tekrar dene",
  "Save profile": "Profili kaydet",
  "Saving encrypted vault…": "Şifreli kasa kaydediliyor…",
  "Saving…": "Kaydediliyor…",
  "Scan or import an authenticator QR code": "Doğrulayıcı QR kodunu tara veya içe aktar",
  "Scan QR": "QR tara",
  "Search authenticator accounts": "Doğrulayıcı hesaplarında ara",
  "Search by service, account, or group…": "Servis, hesap veya gruba göre ara…",
  "Search local logos": "Yerel logolarda ara",
  "Secret key": "Gizli anahtar",
  "Security": "Güvenlik",
  "Select accounts": "Hesap seç",
  "Select all visible": "Görünenlerin tümünü seç",
  "Set default main screen": "Varsayılan ana ekran yap",
  "Settings": "Ayarlar",
  "Settings sections": "Ayar bölümleri",
  "Setup link": "Kurulum bağlantısı",
  "Show": "Göster",
  "Shown in your Coffer profile.": "Coffer profilinde gösterilir.",
  "Sign in": "Giriş yap",
  "Sign-in email": "Giriş e-postası",
  "Signing in…": "Giriş yapılıyor…",
  "Skip": "Atla",
  "Start camera": "Kamerayı başlat",
  "Start over": "Baştan başla",
  "Stop camera": "Kamerayı durdur",
  "The server stores ciphertext only": "Sunucu yalnızca şifreli metni saklar",
  "Theme": "Tema",
  "This action cannot be undone.": "Bu işlem geri alınamaz.",
  "This group is empty. Delete it when you no longer need it.": "Bu grup boş. Artık ihtiyacın yoksa silebilirsin.",
  "Transfer direction": "Aktarım yönü",
  "Try a different search.": "Farklı bir arama dene.",
  "Try another search or add a new authenticator account.": "Başka bir arama dene veya yeni doğrulayıcı hesabı ekle.",
  "Upload logo": "Logo yükle",
  "Use server version": "Sunucu sürümünü kullan",
  "Username": "Kullanıcı adı",
  "Vault data is encrypted before it is saved": "Kasa verisi kaydedilmeden önce şifrelenir",
  "Vault password": "Kasa parolası",
  "Vault session": "Kasa oturumu",
  "View accounts": "Hesapları görüntüle",
  "Waiting for camera access…": "Kamera erişimi bekleniyor…",
  "Your codes. Yours alone.": "Kodların. Yalnızca senin.",
  "Your password cannot be recovered": "Parolan kurtarılamaz",
  "Your password encrypts your vault before it leaves this browser.": "Parolan, kasa bu tarayıcıdan çıkmadan önce onu şifreler.",
  "Used to identify your vault; Coffer cannot use it to reset your password.": "Kasanı tanımlamak için kullanılır; Coffer bunu parolanı sıfırlamak için kullanamaz.",
  "Use at least 12 characters. A unique, memorable passphrase works well.": "En az 12 karakter kullan. Benzersiz ve akılda kalıcı bir parola iyi çalışır.",
  "Use your camera or import a QR image. Scanning happens only on this device.": "Kameranı kullan veya QR görseli içe aktar. Tarama yalnızca bu cihazda yapılır.",
};

const de: TranslationDictionary = {
  ".2fas or JSON, up to 5 MiB": ".2fas oder JSON, bis 5 MiB",
  ".coffer or JSON, up to 5 MiB": ".coffer oder JSON, bis 5 MiB",
  "2FAS backup password": "2FAS-Backup-Passwort",
  "2FAS backup passphrase": "2FAS-Backup-Passphrase",
  "2FAS backup passphrases do not match.": "Die 2FAS-Backup-Passphrasen stimmen nicht überein.",
  "2FAS COMPATIBLE": "2FAS-KOMPATIBEL",
  "2FAS mobile backup": "2FAS-Mobile-Backup",
  "2fas integrated import": "Integrierter 2fas-Import",
  "2fauth integrated import": "Integrierter 2fauth-Import",
  "2FAuth JSON, up to 5 MiB": "2FAuth-JSON, bis 5 MiB",
  "Add to Favorites": "Zu Favoriten hinzufügen",
  "Amber": "Bernstein",
  "Anyone with this file can generate your verification codes.": "Jeder mit dieser Datei kann deine Bestätigungscodes erzeugen.",
  "Apply one logo choice to selected accounts.": "Eine Logo-Auswahl auf die ausgewählten Konten anwenden.",
  "At least 12 characters": "Mindestens 12 Zeichen",
  "Author:": "Autor:",
  "Best-effort removal after 30 seconds if the clipboard still contains that code.": "Bestmögliche Entfernung nach 30 Sekunden, falls die Zwischenablage den Code noch enthält.",
  "Blue": "Blau",
  "Briefcase": "Aktentasche",
  "Camera scanner active.": "Kamerascan aktiv.",
  "Change your vault password and control when the vault locks and how the clipboard behaves.": "Ändere dein Tresorpasswort und steuere, wann der Tresor sperrt und wie sich die Zwischenablage verhält.",
  "Check before adding": "Vor dem Hinzufügen prüfen",
  "Choose a new password that is different from your current password.": "Wähle ein neues Passwort, das sich vom aktuellen unterscheidet.",
  "Choose a unique password that you do not use for another service.": "Wähle ein eindeutiges Passwort, das du für keinen anderen Dienst verwendest.",
  "Coffer backup": "Coffer-Backup",
  "Coffer cannot reset it or decrypt your vault without it.": "Coffer kann es nicht zurücksetzen oder deinen Tresor ohne dieses Passwort entschlüsseln.",
  "Coffer cannot reset it or decrypt your vault without it. Store it somewhere safe.": "Coffer kann es nicht zurücksetzen oder deinen Tresor ohne dieses Passwort entschlüsseln. Bewahre es sicher auf.",
  "Coffer could not change your password. Please try again.": "Coffer konnte dein Passwort nicht ändern. Bitte versuche es erneut.",
  "Coffer could not create your account. Please try again.": "Coffer konnte dein Konto nicht erstellen. Bitte versuche es erneut.",
  "Coffer could not delete this account. Please try again.": "Coffer konnte dieses Konto nicht löschen. Bitte versuche es erneut.",
  "Coffer could not generate a test code. Check the secret and TOTP settings, then try again.": "Coffer konnte keinen Testcode erzeugen. Prüfe das Geheimnis und die TOTP-Einstellungen und versuche es erneut.",
  "Coffer could not remove the profile photo. Please try again.": "Coffer konnte das Profilfoto nicht entfernen. Bitte versuche es erneut.",
  "Coffer could not save the profile photo. Please try again.": "Coffer konnte das Profilfoto nicht speichern. Bitte versuche es erneut.",
  "Coffer could not sign you in. Check your details and try again.": "Coffer konnte dich nicht anmelden. Prüfe deine Angaben und versuche es erneut.",
  "Coffer could not update your profile. Please try again.": "Coffer konnte dein Profil nicht aktualisieren. Bitte versuche es erneut.",
  "Coffer is a multi-user, self-hosted authenticator vault for encrypted TOTP accounts, QR imports, local service logos, groups, and portable backups.": "Coffer ist ein mehrbenutzerfähiger, selbst gehosteter Authenticator-Tresor für verschlüsselte TOTP-Konten, QR-Importe, lokale Dienstlogos, Gruppen und portable Backups.",
  "Color": "Farbe",
  "Confirm that you understand this file contains unencrypted secrets.": "Bestätige, dass du verstehst, dass diese Datei unverschlüsselte Geheimnisse enthält.",
  "Confirm your password.": "Bestätige dein Passwort.",
  "Create a .2fas file for the mobile app. Account secrets are password-protected; 2FAS metadata and group names may remain readable. Archived accounts and custom logos are excluded.": "Erstelle eine .2fas-Datei für die mobile App. Kontogeheimnisse sind passwortgeschützt; 2FAS-Metadaten und Gruppennamen können lesbar bleiben. Archivierte Konten und eigene Logos werden ausgeschlossen.",
  "Create a complete backup containing accounts, groups, favorites, custom logos, and TOTP settings. Add a passphrase for protection, or leave both fields blank.": "Erstelle ein vollständiges Backup mit Konten, Gruppen, Favoriten, eigenen Logos und TOTP-Einstellungen. Füge zum Schutz eine Passphrase hinzu oder lasse beide Felder leer.",
  "Create Coffer account": "Coffer-Konto erstellen",
  "Data & backup": "Daten und Backup",
  "Delete this empty group? This cannot be undone. Accounts are never deleted with a group.": "Diese leere Gruppe löschen? Das kann nicht rückgängig gemacht werden. Konten werden nie zusammen mit einer Gruppe gelöscht.",
  "Display name cannot contain control characters.": "Der Anzeigename darf keine Steuerzeichen enthalten.",
  "Dot": "Punkt",
  "Emerald": "Smaragd",
  "Encrypted in this browser before the vault is saved.": "Wird in diesem Browser verschlüsselt, bevor der Tresor gespeichert wird.",
  "Encrypted vault data is persisted on your self-hosted server and remains available after refresh.": "Verschlüsselte Tresordaten werden auf deinem selbst gehosteten Server gespeichert und bleiben nach dem Aktualisieren verfügbar.",
  "Enter a group name.": "Gib einen Gruppennamen ein.",
  "Enter a valid email address.": "Gib eine gültige E-Mail-Adresse ein.",
  "Enter the name you want Coffer to display.": "Gib den Namen ein, den Coffer anzeigen soll.",
  "Enter your current password.": "Gib dein aktuelles Passwort ein.",
  "Enter your current password to delete this account.": "Gib dein aktuelles Passwort ein, um dieses Konto zu löschen.",
  "Enter your email address.": "Gib deine E-Mail-Adresse ein.",
  "Enter your password.": "Gib dein Passwort ein.",
  "Enter your sign-in email exactly to confirm account deletion.": "Gib deine Anmelde-E-Mail exakt ein, um die Kontolöschung zu bestätigen.",
  "Exported backup files, Kubernetes volume snapshots, and host backups are not removed.": "Exportierte Backup-Dateien, Kubernetes-Volume-Snapshots und Host-Backups werden nicht entfernt.",
  "Finance": "Finanzen",
  "Folder": "Ordner",
  "Generate a code locally from this unsaved secret.": "Erzeuge lokal einen Code aus diesem nicht gespeicherten Geheimnis.",
  "Generated locally from the unsaved secret. Nothing was saved. Compare it with the service before saving.": "Lokal aus dem nicht gespeicherten Geheimnis erzeugt. Nichts wurde gespeichert. Vergleiche ihn vor dem Speichern mit dem Dienst.",
  "Generating a test code locally…": "Testcode wird lokal erzeugt…",
  "Group names can be at most 48 characters.": "Gruppennamen dürfen höchstens 48 Zeichen lang sein.",
  "Group names cannot contain control characters.": "Gruppennamen dürfen keine Steuerzeichen enthalten.",
  "Health": "Gesundheit",
  "Help and issues": "Hilfe und Probleme",
  "Home": "Zuhause",
  "Import a .2fas file from 2FAS and review every account before adding it.": "Importiere eine .2fas-Datei aus 2FAS und prüfe jedes Konto vor dem Hinzufügen.",
  "Import a schema 1 JSON file from 2FAuth and review every account before adding it.": "Importiere eine Schema-1-JSON-Datei aus 2FAuth und prüfe jedes Konto vor dem Hinzufügen.",
  "Interoperable text file · .txt": "Interoperable Textdatei · .txt",
  "Invalid": "Ungültig",
  "Keep both": "Beide behalten",
  "Keep this browser's changes": "Änderungen dieses Browsers behalten",
  "Leave blank or use 12+ characters": "Leer lassen oder 12+ Zeichen verwenden",
  "Leave this blank only if the 2FAS backup was exported without a password.": "Lass dies nur leer, wenn das 2FAS-Backup ohne Passwort exportiert wurde.",
  "Lime": "Limette",
  "Live camera preview for QR scanning": "Live-Kameravorschau für QR-Scan",
  "Looking for a TOTP setup code…": "Suche nach einem TOTP-Setup-Code…",
  "Match each service": "Jeden Dienst zuordnen",
  "Name this empty group and choose how it appears in the sidebar.": "Benenne diese leere Gruppe und wähle, wie sie in der Seitenleiste erscheint.",
  "Never": "Nie",
  "No accounts were found in this file.": "In dieser Datei wurden keine Konten gefunden.",
  "Open a new Coffer issue on GitHub in a new tab": "Neues Coffer-Issue auf GitHub in einem neuen Tab öffnen",
  "Open the Coffer repository on GitHub in a new tab": "Coffer-Repository auf GitHub in einem neuen Tab öffnen",
  "OTPAuth link list": "OTPAuth-Linkliste",
  "OTPAuth URI list": "OTPAuth-URI-Liste",
  "Password changed.": "Passwort geändert.",
  "Passphrases do not match.": "Die Passphrasen stimmen nicht überein.",
  "Permanently remove this user and its encrypted vault from Coffer server storage.": "Diesen Benutzer und seinen verschlüsselten Tresor dauerhaft aus dem Coffer-Serverspeicher entfernen.",
  "Person": "Person",
  "Personal": "Persönlich",
  "PNG, JPEG, or WebP · maximum 10 MiB · processed locally": "PNG, JPEG oder WebP · maximal 10 MiB · lokal verarbeitet",
  "PNG, JPEG, or WebP. Photos are cropped to a square and stored inside your encrypted vault.": "PNG, JPEG oder WebP. Fotos werden quadratisch zugeschnitten und in deinem verschlüsselten Tresor gespeichert.",
  "PNG, JPEG, or WebP up to 5 MB. Fitted to 128 × 128 and safely checked against the encrypted vault's logo limit.": "PNG, JPEG oder WebP bis 5 MB. Wird auf 128 × 128 angepasst und sicher gegen das Logo-Limit des verschlüsselten Tresors geprüft.",
  "Profile photo removed.": "Profilfoto entfernt.",
  "Profile photo updated.": "Profilfoto aktualisiert.",
  "Profile updated.": "Profil aktualisiert.",
  "Processing logo…": "Logo wird verarbeitet…",
  "Readable complete backup · .json": "Lesbares vollständiges Backup · .json",
  "Recommended": "Empfohlen",
  "Reload this page after the vault server is available.": "Lade diese Seite neu, sobald der Tresorserver verfügbar ist.",
  "Rename this group and choose how it appears in the sidebar.": "Benenne diese Gruppe um und wähle, wie sie in der Seitenleiste erscheint.",
  "Restore accounts, groups, favorites, and TOTP settings from a Coffer backup, with or without a passphrase.": "Stelle Konten, Gruppen, Favoriten und TOTP-Einstellungen aus einem Coffer-Backup wieder her, mit oder ohne Passphrase.",
  "Resolving…": "Wird gelöst…",
  "Rose": "Rose",
  "Secrets stay hidden during review and are encrypted before they are saved.": "Geheimnisse bleiben während der Prüfung verborgen und werden vor dem Speichern verschlüsselt.",
  "Securing pending encrypted changes and clearing this browser session…": "Ausstehende verschlüsselte Änderungen werden gesichert und diese Browsersitzung wird gelöscht…",
  "Shield": "Schild",
  "Shopping": "Einkaufen",
  "Sky": "Himmelblau",
  "Slate": "Schiefer",
  "Social": "Sozial",
  "Stack:": "Stack:",
  "Star": "Stern",
  "Suggested logos are based on the selected accounts' shared platform. Choose one or keep automatic matching.": "Vorgeschlagene Logos basieren auf der gemeinsamen Plattform der ausgewählten Konten. Wähle eines oder behalte die automatische Zuordnung.",
  "The downloaded file will contain readable authentication secrets.": "Die heruntergeladene Datei enthält lesbare Authentifizierungsgeheimnisse.",
  "The generated code expired before it could be shown.": "Der erzeugte Code ist abgelaufen, bevor er angezeigt werden konnte.",
  "The group could not be deleted.": "Die Gruppe konnte nicht gelöscht werden.",
  "The group could not be saved.": "Die Gruppe konnte nicht gespeichert werden.",
  "The group could not be saved. Check the name and try again.": "Die Gruppe konnte nicht gespeichert werden. Prüfe den Namen und versuche es erneut.",
  "The new passwords do not match.": "Die neuen Passwörter stimmen nicht überein.",
  "The passwords do not match.": "Die Passwörter stimmen nicht überein.",
  "The profile could not be updated while the vault is unavailable.": "Das Profil kann nicht aktualisiert werden, solange der Tresor nicht verfügbar ist.",
  "The profile photo could not be removed while the vault is unavailable.": "Das Profilfoto kann nicht entfernt werden, solange der Tresor nicht verfügbar ist.",
  "The profile photo could not be saved while the vault is unavailable.": "Das Profilfoto kann nicht gespeichert werden, solange der Tresor nicht verfügbar ist.",
  "The selected accounts could not be updated.": "Die ausgewählten Konten konnten nicht aktualisiert werden.",
  "The selected image could not be processed.": "Das ausgewählte Bild konnte nicht verarbeitet werden.",
  "The selected image could not be scanned. Try a PNG, JPEG, or WebP image with a clear QR code.": "Das ausgewählte Bild konnte nicht gescannt werden. Versuche ein PNG-, JPEG- oder WebP-Bild mit klarem QR-Code.",
  "The selected logo could not be processed.": "Das ausgewählte Logo konnte nicht verarbeitet werden.",
  "This cannot be undone after the file is downloaded.": "Dies kann nach dem Herunterladen der Datei nicht rückgängig gemacht werden.",
  "This does not look like a Coffer backup.": "Das sieht nicht wie ein Coffer-Backup aus.",
  "This file is larger than the 5 MiB import limit.": "Diese Datei ist größer als das Importlimit von 5 MiB.",
  "Travel": "Reisen",
  "Unencrypted export downloaded.": "Unverschlüsselter Export heruntergeladen.",
  "Unlock your vault before creating a backup.": "Entsperre deinen Tresor, bevor du ein Backup erstellst.",
  "Uploaded logo ready for the selected accounts.": "Hochgeladenes Logo ist für die ausgewählten Konten bereit.",
  "Use 12+ printable ASCII characters for iOS and Android compatibility. 2FAS cannot recover this passphrase.": "Verwende 12+ druckbare ASCII-Zeichen für iOS- und Android-Kompatibilität. 2FAS kann diese Passphrase nicht wiederherstellen.",
  "Use only printable ASCII characters in the 2FAS passphrase for iOS and Android compatibility.": "Verwende in der 2FAS-Passphrase nur druckbare ASCII-Zeichen für iOS- und Android-Kompatibilität.",
  "Violet": "Violett",
  "We could not create the 2FAS mobile backup.": "Das 2FAS-Mobile-Backup konnte nicht erstellt werden.",
  "We could not create the Coffer backup.": "Das Coffer-Backup konnte nicht erstellt werden.",
  "We could not read this file. It may be damaged or incomplete.": "Diese Datei konnte nicht gelesen werden. Sie ist möglicherweise beschädigt oder unvollständig.",
  "When enabled, switching tabs or minimizing the browser locks the vault immediately, regardless of the automatic lock delay.": "Wenn aktiviert, sperrt ein Tabwechsel oder das Minimieren des Browsers den Tresor sofort, unabhängig von der Verzögerung der automatischen Sperre.",
  "Without a passphrase, anyone with this file can read your authentication secrets. Coffer cannot recover a forgotten passphrase.": "Ohne Passphrase kann jeder mit dieser Datei deine Authentifizierungsgeheimnisse lesen. Coffer kann eine vergessene Passphrase nicht wiederherstellen.",
  "Work": "Arbeit",
  "Your authentication secrets will be readable without a password.": "Deine Authentifizierungsgeheimnisse sind ohne Passwort lesbar.",
  "About": "Info",
  "About Archive": "Über das Archiv",
  "About Coffer": "Über Coffer",
  "Account access": "Kontozugriff",
  "Account input method": "Eingabemethode",
  "Account name": "Kontoname",
  "Account selection actions": "Aktionen für ausgewählte Konten",
  "ACCOUNT DETAILS": "KONTODETAILS",
  "ACCOUNT LOGOS": "KONTOLOGOS",
  "Add account": "Konto hinzufügen",
  "Add a new account": "Neues Konto hinzufügen",
  "Add a new authenticator account": "Neues Authenticator-Konto hinzufügen",
  "Add a service and account name.": "Dienst und Kontonamen hinzufügen.",
  "All codes": "Alle Codes",
  "All codes is now the default main screen.": "Alle Codes ist jetzt der Standard-Startbildschirm.",
  "All codes options": "Optionen für alle Codes",
  "All visible selected": "Alle sichtbaren ausgewählt",
  "Apply": "Anwenden",
  "Applying…": "Wird angewendet…",
  "Archive": "Archiv",
  "Archive is empty": "Das Archiv ist leer",
  "Archived": "Archiviert",
  "Archived account selection actions": "Aktionen für archivierte Konten",
  "Archived accounts stay encrypted and keep generating codes until you restore them.": "Archivierte Konten bleiben verschlüsselt und erzeugen weiter Codes, bis du sie wiederherstellst.",
  "Automatic": "Automatisch",
  "Automatic lock": "Automatische Sperre",
  "Automatic lock delay": "Verzögerung der automatischen Sperre",
  "Automatic matching keeps each account linked to its own service name.": "Die automatische Zuordnung verknüpft jedes Konto mit seinem Dienstnamen.",
  "Back to all codes": "Zurück zu allen Codes",
  "Backup passphrase (if used)": "Backup-Passphrase (falls verwendet)",
  "Backup passphrase (optional)": "Backup-Passphrase (optional)",
  "Balanced cards": "Ausgewogene Karten",
  "Base32 secret": "Base32-Geheimnis",
  "Browser-encrypted vault": "Im Browser verschlüsselter Tresor",
  "Cancel": "Abbrechen",
  "Card view": "Kartenansicht",
  "Change file": "Datei ändern",
  "Change password": "Passwort ändern",
  "Change photo": "Foto ändern",
  "Change selected logos": "Ausgewählte Logos ändern",
  "Changing password…": "Passwort wird geändert…",
  "Checking accounts…": "Konten werden geprüft…",
  "Checking QR scanner support…": "QR-Scanner-Unterstützung wird geprüft…",
  "Checking your encrypted vault session…": "Verschlüsselte Tresorsitzung wird geprüft…",
  "Choose a group": "Gruppe auswählen",
  "Choose file": "Datei auswählen",
  "Choose the interface language.": "Wähle die Sprache der Oberfläche.",
  "Choose photo": "Foto auswählen",
  "Choose platform logo": "Plattformlogo auswählen",
  "Choose which encrypted vault version to keep": "Wähle, welche verschlüsselte Tresorversion behalten wird",
  "Clear copied codes": "Kopierte Codes löschen",
  "Clear search": "Suche löschen",
  "Clear selection": "Auswahl löschen",
  "Close account editor": "Kontoeditor schließen",
  "Close add account dialog": "Dialog zum Hinzufügen schließen",
  "Close bulk logo picker": "Logo-Auswahl schließen",
  "Close group customization": "Gruppenanpassung schließen",
  "Colored letter tile": "Farbige Buchstabenkachel",
  "Compact": "Kompakt",
  "Condensed horizontal cards": "Kompakte horizontale Karten",
  "Confirm delete": "Löschen bestätigen",
  "Confirm new password": "Neues Passwort bestätigen",
  "Confirm passphrase": "Passphrase bestätigen",
  "Confirm password": "Passwort bestätigen",
  "Create 2fas export": "2FAS-Export erstellen",
  "Create account": "Konto erstellen",
  "Create an encrypted vault": "Verschlüsselten Tresor erstellen",
  "Create export without a passphrase?": "Export ohne Passphrase erstellen?",
  "Create group": "Gruppe erstellen",
  "Create protected backup": "Geschütztes Backup erstellen",
  "Create unprotected export": "Ungeschützten Export erstellen",
  "Create & move": "Erstellen und verschieben",
  "Creating 2fas export…": "2FAS-Export wird erstellt…",
  "Creating account…": "Konto wird erstellt…",
  "Creating export…": "Export wird erstellt…",
  "Creating your 2fas export…": "Dein 2FAS-Export wird erstellt…",
  "Creating your Coffer export…": "Dein Coffer-Export wird erstellt…",
  "Current": "Aktuell",
  "Current password": "Aktuelles Passwort",
  "Custom logo": "Eigenes Logo",
  "Customize group": "Gruppe anpassen",
  "Dangerous": "Gefährlich",
  "Data and backup": "Daten und Backup",
  "Default": "Standard",
  "Default main screen": "Standard-Startbildschirm",
  "Delete account": "Konto löschen",
  "Delete account permanently": "Konto dauerhaft löschen",
  "Delete group": "Gruppe löschen",
  "Delete permanently": "Dauerhaft löschen",
  "Delete selected": "Ausgewählte löschen",
  "Delete this account": "Dieses Konto löschen",
  "Deleting account…": "Konto wird gelöscht…",
  "Deleting…": "Wird gelöscht…",
  "Digits": "Stellen",
  "Display name": "Anzeigename",
  "Do not ask for login information on this browser for 30 days.": "In diesem Browser 30 Tage lang keine Anmeldedaten abfragen.",
  "Done": "Fertig",
  "Download unprotected export": "Ungeschützten Export herunterladen",
  "Drop a file here": "Datei hier ablegen",
  "Edit": "Bearbeiten",
  "Edit account": "Konto bearbeiten",
  "Email": "E-Mail",
  "Encrypted in your browser": "Im Browser verschlüsselt",
  "Encrypted vault saved": "Verschlüsselter Tresor gespeichert",
  "Enter a different valid Base32 secret to enable Test.": "Gib ein anderes gültiges Base32-Geheimnis ein, um den Test zu aktivieren.",
  "Enter one link per line. Blank lines are ignored.": "Gib pro Zeile einen Link ein. Leere Zeilen werden ignoriert.",
  "Enter the same password again.": "Gib dasselbe Passwort erneut ein.",
  "Existing group": "Vorhandene Gruppe",
  "Export": "Export",
  "Export anyway": "Trotzdem exportieren",
  "Export readable secrets?": "Lesbare Geheimnisse exportieren?",
  "Export unencrypted file": "Unverschlüsselte Datei exportieren",
  "Favorites": "Favoriten",
  "Files are processed in this browser. Approved imports are encrypted before storage.": "Dateien werden in diesem Browser verarbeitet. Bestätigte Importe werden vor dem Speichern verschlüsselt.",
  "GitHub repository": "GitHub-Repository",
  "Go back": "Zurück",
  "Go to default main screen": "Zum Standard-Startbildschirm",
  "Grid": "Raster",
  "Group": "Gruppe",
  "Group name": "Gruppenname",
  "GROUP DETAILS": "GRUPPENDETAILS",
  "Groups": "Gruppen",
  "Hidden, not deleted": "Ausgeblendet, nicht gelöscht",
  "Hide": "Ausblenden",
  "I only have the secret key": "Ich habe nur den geheimen Schlüssel",
  "Icon": "Symbol",
  "Import": "Import",
  "Import another file": "Weitere Datei importieren",
  "Import QR code": "QR-Code importieren",
  "Important": "Wichtig",
  "Initials": "Initialen",
  "Language": "Sprache",
  "Lock and sign out": "Sperren und abmelden",
  "Lock immediately when Coffer is hidden": "Sofort sperren, wenn Coffer ausgeblendet ist",
  "Lock vault": "Tresor sperren",
  "Lock vault now": "Tresor jetzt sperren",
  "Locking your vault": "Tresor wird gesperrt",
  "Manual entry": "Manuelle Eingabe",
  "More cards per row": "Mehr Karten pro Zeile",
  "Move": "Verschieben",
  "Move selected accounts": "Ausgewählte Konten verschieben",
  "Move to Archive": "Ins Archiv verschieben",
  "Move to group": "In Gruppe verschieben",
  "NEW AUTHENTICATOR": "NEUER AUTHENTICATOR",
  "NEW GROUP": "NEUE GRUPPE",
  "New": "Neu",
  "New group": "Neue Gruppe",
  "New password": "Neues Passwort",
  "Next": "Nächster",
  "No archived accounts found": "Keine archivierten Konten gefunden",
  "No catalog logos match. Automatic matching remains selected.": "Keine passenden Kataloglogos. Automatische Zuordnung bleibt ausgewählt.",
  "No codes found": "Keine Codes gefunden",
  "No groups yet": "Noch keine Gruppen",
  "Open About settings": "Info-Einstellungen öffnen",
  "Open data & backup": "Daten und Backup öffnen",
  "Opening Coffer": "Coffer wird geöffnet",
  "or upload a text file": "oder eine Textdatei hochladen",
  "OTPAuth links": "OTPAuth-Links",
  "Password": "Passwort",
  "Paste your setup link": "Setup-Link einfügen",
  "Period": "Zeitraum",
  "Plain Coffer JSON": "Lesbares Coffer-JSON",
  "Plain UTF-8 text, up to 5 MiB": "Einfacher UTF-8-Text, bis 5 MiB",
  "Platform logo": "Plattformlogo",
  "Plaintext export": "Klartext-Export",
  "Profile": "Profil",
  "Profile photo": "Profilfoto",
  "Read and write Coffer in your preferred language. This setting stays in this browser and updates the interface immediately.": "Nutze Coffer in deiner bevorzugten Sprache. Diese Einstellung bleibt in diesem Browser und aktualisiert die Oberfläche sofort.",
  "Reading and checking accounts…": "Konten werden gelesen und geprüft…",
  "Ready to review": "Bereit zur Prüfung",
  "RECOMMENDED": "EMPFOHLEN",
  "Remember this browser": "Diesen Browser merken",
  "Remove": "Entfernen",
  "Remove from Favorites": "Aus Favoriten entfernen",
  "Remove upload": "Upload entfernen",
  "Replace and import": "Ersetzen und importieren",
  "Replace existing": "Vorhandenes ersetzen",
  "Replace logo": "Logo ersetzen",
  "Repeat it if used": "Wiederholen, falls verwendet",
  "Repeat your passphrase": "Passphrase wiederholen",
  "Restore all codes": "Alle Codes wiederherstellen",
  "Restore selected": "Ausgewählte wiederherstellen",
  "Review account": "Konto prüfen",
  "Review accounts": "Konten prüfen",
  "REVIEW IMPORT": "IMPORT PRÜFEN",
  "Save changes": "Änderungen speichern",
  "Save conflict": "Speicherkonflikt",
  "Save failed · Retry": "Speichern fehlgeschlagen · Erneut versuchen",
  "Save profile": "Profil speichern",
  "Saving encrypted vault…": "Verschlüsselter Tresor wird gespeichert…",
  "Saving…": "Wird gespeichert…",
  "Scan or import an authenticator QR code": "Authenticator-QR-Code scannen oder importieren",
  "Scan QR": "QR scannen",
  "Search authenticator accounts": "Authenticator-Konten durchsuchen",
  "Search by service, account, or group…": "Nach Dienst, Konto oder Gruppe suchen…",
  "Search local logos": "Lokale Logos suchen",
  "Secret key": "Geheimer Schlüssel",
  "Security": "Sicherheit",
  "Select accounts": "Konten auswählen",
  "Select all visible": "Alle sichtbaren auswählen",
  "Set default main screen": "Als Standard-Startbildschirm festlegen",
  "Settings": "Einstellungen",
  "Settings sections": "Einstellungsbereiche",
  "Setup link": "Setup-Link",
  "Show": "Anzeigen",
  "Shown in your Coffer profile.": "Wird in deinem Coffer-Profil angezeigt.",
  "Sign in": "Anmelden",
  "Sign-in email": "Anmelde-E-Mail",
  "Signing in…": "Anmeldung läuft…",
  "Skip": "Überspringen",
  "Start camera": "Kamera starten",
  "Start over": "Neu beginnen",
  "Stop camera": "Kamera stoppen",
  "The server stores ciphertext only": "Der Server speichert nur Geheimtext",
  "Theme": "Design",
  "This action cannot be undone.": "Diese Aktion kann nicht rückgängig gemacht werden.",
  "This group is empty. Delete it when you no longer need it.": "Diese Gruppe ist leer. Lösche sie, wenn du sie nicht mehr brauchst.",
  "Transfer direction": "Übertragungsrichtung",
  "Try a different search.": "Versuche eine andere Suche.",
  "Try another search or add a new authenticator account.": "Versuche eine andere Suche oder füge ein neues Authenticator-Konto hinzu.",
  "Upload logo": "Logo hochladen",
  "Use server version": "Serverversion verwenden",
  "Username": "Benutzername",
  "Vault data is encrypted before it is saved": "Tresordaten werden vor dem Speichern verschlüsselt",
  "Vault password": "Tresorpasswort",
  "Vault session": "Tresorsitzung",
  "View accounts": "Konten anzeigen",
  "Waiting for camera access…": "Warten auf Kamerazugriff…",
  "Your codes. Yours alone.": "Deine Codes. Nur deine.",
  "Your password cannot be recovered": "Dein Passwort kann nicht wiederhergestellt werden",
  "Your password encrypts your vault before it leaves this browser.": "Dein Passwort verschlüsselt deinen Tresor, bevor er diesen Browser verlässt.",
  "Used to identify your vault; Coffer cannot use it to reset your password.": "Wird verwendet, um deinen Tresor zu identifizieren; Coffer kann es nicht zum Zurücksetzen deines Passworts nutzen.",
  "Use at least 12 characters. A unique, memorable passphrase works well.": "Verwende mindestens 12 Zeichen. Eine eindeutige, gut merkbare Passphrase funktioniert gut.",
  "Use your camera or import a QR image. Scanning happens only on this device.": "Verwende deine Kamera oder importiere ein QR-Bild. Das Scannen erfolgt nur auf diesem Gerät.",
};

const exactDictionaries: Record<CofferLanguage, TranslationDictionary> = {
  en: {},
  tr,
  de,
};

const trPatterns: TranslationPattern[] = [
  { pattern: /^(\d+) selected$/u, replace: (count) => `${count} seçili` },
  { pattern: /^(\d+) visible$/u, replace: (count) => `${count} görünür` },
  { pattern: /^(\d+) archived$/u, replace: (count) => `${count} arşivlendi` },
  { pattern: /^(\d+) accounts?$/u, replace: (count) => `${count} hesap` },
  { pattern: /^(\d+) new$/u, replace: (count) => `${count} yeni` },
  { pattern: /^(\d+) duplicates$/u, replace: (count) => `${count} kopya` },
  { pattern: /^(\d+) need attention$/u, replace: (count) => `${count} dikkat istiyor` },
  { pattern: /^After (\d+) minute$/u, replace: (count) => `${count} dakika sonra` },
  { pattern: /^After (\d+) minutes$/u, replace: (count) => `${count} dakika sonra` },
  { pattern: /^(\d+) digits$/u, replace: (count) => `${count} hane` },
  { pattern: /^(\d+) seconds$/u, replace: (count) => `${count} saniye` },
  { pattern: /^Use (\d+) to (\d+) characters\.$/u, replace: (min, max) => `${min} ile ${max} karakter kullan.` },
  { pattern: /^Use at least (\d+) characters\.$/u, replace: (count) => `En az ${count} karakter kullan.` },
  { pattern: /^Use (\d+) characters or fewer\.$/u, replace: (count) => `${count} veya daha az karakter kullan.` },
  { pattern: /^Use a new password with at least (\d+) characters\.$/u, replace: (count) => `Yeni parola için en az ${count} karakter kullan.` },
  { pattern: /^Use a backup passphrase with at least (\d+) characters\.$/u, replace: (count) => `Yedek parolası için en az ${count} karakter kullan.` },
  { pattern: /^Enter (.+) to confirm$/u, replace: (value) => `Onaylamak için ${value} gir` },
  { pattern: /^Import (\d+) accounts?$/u, replace: (count) => `${count} hesabı içe aktar` },
  { pattern: /^Apply to (\d+)$/u, replace: (count) => `${count} hesaba uygula` },
  { pattern: /^Apply one logo choice to (\d+) selected accounts?\.$/u, replace: (count) => `Tek bir logo seçimini ${count} seçili hesaba uygula.` },
  { pattern: /^(\d+) matching local logos?\. Choose one below\.$/u, replace: (count) => `${count} eşleşen yerel logo. Aşağıdan birini seç.` },
  { pattern: /^(.+) selected from Coffer's local catalog\.$/u, replace: (label) => `${label} Coffer'ın yerel kataloğundan seçildi.` },
  { pattern: /^Import action for (.+)$/u, replace: (label) => `${label} için içe aktarma işlemi` },
  { pattern: /^Coffer version (.+)$/u, replace: (version) => `Coffer sürümü ${version}` },
  { pattern: /^Search logos for (.+)$/u, replace: (service) => `${service} için logo ara` },
  { pattern: /^Open (.+) options$/u, replace: (name) => `${name} seçeneklerini aç` },
  { pattern: /^Open (.+) group options$/u, replace: (name) => `${name} grup seçeneklerini aç` },
  { pattern: /^Copy (.+) code when ready$/u, replace: (name) => `${name} kodunu hazır olduğunda kopyala` },
  { pattern: /^Current code (.+)$/u, replace: (code) => `Geçerli kod ${code}` },
  { pattern: /^Next code (.+)$/u, replace: (code) => `Sonraki kod ${code}` },
  { pattern: /^(.+) account was imported\.$/u, replace: (count) => `${count} hesap içe aktarıldı.` },
  { pattern: /^(.+) accounts were imported\.$/u, replace: (count) => `${count} hesap içe aktarıldı.` },
  { pattern: /^(.+) entry was skipped\./u, replace: (count) => `${count} kayıt atlandı.` },
  { pattern: /^(.+) entries were skipped\./u, replace: (count) => `${count} kayıt atlandı.` },
  { pattern: /^(.+) group created\.$/u, replace: (name) => `${name} grubu oluşturuldu.` },
  { pattern: /^(.+) appearance updated\.$/u, replace: (name) => `${name} görünümü güncellendi.` },
  { pattern: /^(.+) updated to (.+)\.$/u, replace: (previous, next) => `${previous}, ${next} olarak güncellendi.` },
  { pattern: /^(.+) group deleted\.$/u, replace: (name) => `${name} grubu silindi.` },
  { pattern: /^(.+) group moved\.$/u, replace: (name) => `${name} grubu taşındı.` },
  { pattern: /^(.+) code copied\.$/u, replace: (name) => `${name} kodu kopyalandı.` },
  { pattern: /^(.+) restored to All codes\.$/u, replace: (name) => `${name} Tüm kodlara geri yüklendi.` },
  { pattern: /^(.+) moved to Archive\.$/u, replace: (name) => `${name} Arşive taşındı.` },
  { pattern: /^(.+) updated in the encrypted vault\.$/u, replace: (name) => `${name} şifreli kasada güncellendi.` },
  { pattern: /^v(.+) available!$/u, replace: (version) => `v${version} mevcut!` },
];

const dePatterns: TranslationPattern[] = [
  { pattern: /^(\d+) selected$/u, replace: (count) => `${count} ausgewählt` },
  { pattern: /^(\d+) visible$/u, replace: (count) => `${count} sichtbar` },
  { pattern: /^(\d+) archived$/u, replace: (count) => `${count} archiviert` },
  { pattern: /^(\d+) accounts?$/u, replace: (count) => `${count} Konto${count === "1" ? "" : "en"}` },
  { pattern: /^(\d+) new$/u, replace: (count) => `${count} neu` },
  { pattern: /^(\d+) duplicates$/u, replace: (count) => `${count} Duplikate` },
  { pattern: /^(\d+) need attention$/u, replace: (count) => `${count} benötigen Aufmerksamkeit` },
  { pattern: /^After (\d+) minute$/u, replace: (count) => `Nach ${count} Minute` },
  { pattern: /^After (\d+) minutes$/u, replace: (count) => `Nach ${count} Minuten` },
  { pattern: /^(\d+) digits$/u, replace: (count) => `${count} Stellen` },
  { pattern: /^(\d+) seconds$/u, replace: (count) => `${count} Sekunden` },
  { pattern: /^Use (\d+) to (\d+) characters\.$/u, replace: (min, max) => `${min} bis ${max} Zeichen verwenden.` },
  { pattern: /^Use at least (\d+) characters\.$/u, replace: (count) => `Mindestens ${count} Zeichen verwenden.` },
  { pattern: /^Use (\d+) characters or fewer\.$/u, replace: (count) => `${count} Zeichen oder weniger verwenden.` },
  { pattern: /^Use a new password with at least (\d+) characters\.$/u, replace: (count) => `Verwende ein neues Passwort mit mindestens ${count} Zeichen.` },
  { pattern: /^Use a backup passphrase with at least (\d+) characters\.$/u, replace: (count) => `Verwende eine Backup-Passphrase mit mindestens ${count} Zeichen.` },
  { pattern: /^Enter (.+) to confirm$/u, replace: (value) => `Gib ${value} zur Bestätigung ein` },
  { pattern: /^Import (\d+) accounts?$/u, replace: (count) => `${count} Konto${count === "1" ? "" : "en"} importieren` },
  { pattern: /^Apply to (\d+)$/u, replace: (count) => `Auf ${count} anwenden` },
  { pattern: /^Apply one logo choice to (\d+) selected accounts?\.$/u, replace: (count) => `Eine Logo-Auswahl auf ${count} ausgewählte${count === "1" ? "s Konto" : " Konten"} anwenden.` },
  { pattern: /^(\d+) matching local logos?\. Choose one below\.$/u, replace: (count) => `${count} passende lokale${count === "1" ? "s Logo" : " Logos"}. Wähle unten eines aus.` },
  { pattern: /^(.+) selected from Coffer's local catalog\.$/u, replace: (label) => `${label} wurde aus dem lokalen Coffer-Katalog ausgewählt.` },
  { pattern: /^Import action for (.+)$/u, replace: (label) => `Importaktion für ${label}` },
  { pattern: /^Coffer version (.+)$/u, replace: (version) => `Coffer-Version ${version}` },
  { pattern: /^Search logos for (.+)$/u, replace: (service) => `Logos für ${service} suchen` },
  { pattern: /^Open (.+) options$/u, replace: (name) => `Optionen für ${name} öffnen` },
  { pattern: /^Open (.+) group options$/u, replace: (name) => `Gruppenoptionen für ${name} öffnen` },
  { pattern: /^Copy (.+) code when ready$/u, replace: (name) => `${name}-Code kopieren, sobald er bereit ist` },
  { pattern: /^Current code (.+)$/u, replace: (code) => `Aktueller Code ${code}` },
  { pattern: /^Next code (.+)$/u, replace: (code) => `Nächster Code ${code}` },
  { pattern: /^(.+) account was imported\.$/u, replace: (count) => `${count} Konto wurde importiert.` },
  { pattern: /^(.+) accounts were imported\.$/u, replace: (count) => `${count} Konten wurden importiert.` },
  { pattern: /^(.+) entry was skipped\./u, replace: (count) => `${count} Eintrag wurde übersprungen.` },
  { pattern: /^(.+) entries were skipped\./u, replace: (count) => `${count} Einträge wurden übersprungen.` },
  { pattern: /^(.+) group created\.$/u, replace: (name) => `Gruppe ${name} wurde erstellt.` },
  { pattern: /^(.+) appearance updated\.$/u, replace: (name) => `Darstellung von ${name} wurde aktualisiert.` },
  { pattern: /^(.+) updated to (.+)\.$/u, replace: (previous, next) => `${previous} wurde zu ${next} geändert.` },
  { pattern: /^(.+) group deleted\.$/u, replace: (name) => `Gruppe ${name} wurde gelöscht.` },
  { pattern: /^(.+) group moved\.$/u, replace: (name) => `Gruppe ${name} wurde verschoben.` },
  { pattern: /^(.+) code copied\.$/u, replace: (name) => `${name}-Code kopiert.` },
  { pattern: /^(.+) restored to All codes\.$/u, replace: (name) => `${name} wurde zu Alle Codes wiederhergestellt.` },
  { pattern: /^(.+) moved to Archive\.$/u, replace: (name) => `${name} wurde ins Archiv verschoben.` },
  { pattern: /^(.+) updated in the encrypted vault\.$/u, replace: (name) => `${name} wurde im verschlüsselten Tresor aktualisiert.` },
  { pattern: /^v(.+) available!$/u, replace: (version) => `v${version} verfügbar!` },
];

const patterns: Record<CofferLanguage, TranslationPattern[]> = {
  en: [],
  tr: trPatterns,
  de: dePatterns,
};

const translatedAttributes = [
  "aria-label",
  "title",
  "placeholder",
  "alt",
  "data-tip",
] as const;

const originalText = new WeakMap<Text, string>();
const appliedText = new WeakMap<Text, string>();
const originalElementText = new WeakMap<Element, string>();
const appliedElementText = new WeakMap<Element, string>();
const elementTextParents = new WeakSet<Element>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const appliedAttributes = new WeakMap<Element, Map<string, string>>();

export function translateText(language: CofferLanguage, value: string): string {
  if (language === "en") return value;
  const leadingWhitespace = value.match(/^\s*/u)?.[0] ?? "";
  const trailingWhitespace = value.match(/\s*$/u)?.[0] ?? "";
  const sourceValue = value.replace(/\s+/gu, " ").trim();
  if (!sourceValue) return value;
  const dictionary = exactDictionaries[language];
  const exact = dictionary[sourceValue];
  if (exact) return `${leadingWhitespace}${exact}${trailingWhitespace}`;
  for (const { pattern, replace } of patterns[language]) {
    const match = sourceValue.match(pattern);
    if (match) return `${leadingWhitespace}${replace(...match.slice(1))}${trailingWhitespace}`;
  }
  return value;
}

function shouldSkipNode(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  if (!element) return false;
  if (element.closest("[data-i18n-ignore]")) return true;
  const tag = element.tagName;
  return tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "CODE";
}

function applyTextNode(language: CofferLanguage, node: Text) {
  if (shouldSkipNode(node)) return;
  if (node.parentElement && elementTextParents.has(node.parentElement)) return;
  const current = node.nodeValue ?? "";
  if (!current.trim()) return;

  const previousApplied = appliedText.get(node);
  if (!originalText.has(node) || (previousApplied !== undefined && current !== previousApplied)) {
    originalText.set(node, current);
  }

  const source = originalText.get(node) ?? current;
  const next = translateText(language, source);
  if (current !== next) node.nodeValue = next;
  appliedText.set(node, next);
}

function applyElementTextContent(language: CofferLanguage, element: Element) {
  if (shouldSkipNode(element)) return;
  const hasManagedText = originalElementText.has(element);
  const hasOnlyTextChildren = Array.from(element.childNodes).every((node) => node.nodeType === Node.TEXT_NODE);
  if (!hasOnlyTextChildren || (!hasManagedText && element.childNodes.length < 2)) {
    elementTextParents.delete(element);
    return;
  }

  const current = element.textContent ?? "";
  if (!current.trim()) {
    elementTextParents.delete(element);
    return;
  }

  const previousApplied = appliedElementText.get(element);
  if (!originalElementText.has(element) || (previousApplied !== undefined && current !== previousApplied)) {
    originalElementText.set(element, current);
  }

  const source = originalElementText.get(element) ?? current;
  const next = translateText(language, source);
  elementTextParents.add(element);
  if (current !== next) element.textContent = next;
  appliedElementText.set(element, next);
}

function sourceAttribute(element: Element, attribute: string, current: string): string {
  const originals = originalAttributes.get(element) ?? new Map<string, string>();
  const applied = appliedAttributes.get(element)?.get(attribute);
  if (!originals.has(attribute) || (applied !== undefined && current !== applied)) {
    originals.set(attribute, current);
    originalAttributes.set(element, originals);
  }
  return originals.get(attribute) ?? current;
}

function applyElementAttributes(language: CofferLanguage, element: Element) {
  if (shouldSkipNode(element)) return;
  for (const attribute of translatedAttributes) {
    const current = element.getAttribute(attribute);
    if (!current?.trim()) continue;
    const source = sourceAttribute(element, attribute, current);
    const next = translateText(language, source);
    if (current !== next) element.setAttribute(attribute, next);
    const applied = appliedAttributes.get(element) ?? new Map<string, string>();
    applied.set(attribute, next);
    appliedAttributes.set(element, applied);
  }
}

function applyLanguage(language: CofferLanguage, root: ParentNode = document.body) {
  if (root instanceof Element) {
    applyElementAttributes(language, root);
    applyElementTextContent(language, root);
  }

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );

  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      applyTextNode(language, node as Text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      applyElementAttributes(language, element);
      applyElementTextContent(language, element);
    }
    node = walker.nextNode();
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<CofferLanguage>(() => readStoredLanguage());

  const setLanguage = useCallback((nextLanguage: CofferLanguage) => {
    setLanguageState(nextLanguage);
    writeStoredLanguage(nextLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    applyLanguage(language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          applyTextNode(language, mutation.target as Text);
          continue;
        }
        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          applyElementAttributes(language, mutation.target);
          continue;
        }
        if (mutation.target instanceof Element) {
          applyElementTextContent(language, mutation.target);
        }
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) applyTextNode(language, node as Text);
          else if (node.nodeType === Node.ELEMENT_NODE) applyLanguage(language, node as Element);
        });
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...translatedAttributes],
    });
    return () => observer.disconnect();
  }, [language]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage,
    translate: (text) => translateText(language, text),
  }), [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
