import React from 'react';

export const LegalDocs = () => {
  return (
    <div className="p-4 bg-white text-gray-800 dark:bg-gray-900 dark:text-gray-200 max-w-4xl mx-auto">
      {/* --- IMPRESSUM --- */}
      <section className="mb-12 border-b border-gray-300 pb-8">
        <h1 className="text-3xl font-bold mb-6">Impressum</h1>
        <p className="mb-4">Angaben gemäß § 5 TMG</p>

        <h2 className="text-xl font-semibold mt-4 mb-2">Betreiber & Kontakt</h2>
        <p>
          <strong>Blyve</strong>
          <br />
          Vertreten durch:
          <br />
          [DEIN VORNAME] [DEIN NACHNAME]
          <br />
          [DEINE STRASSE UND HAUSNUMMER]
          <br />
          [DEINE PLZ] Saarlouis
          <br />
          Deutschland
        </p>

        <h2 className="text-xl font-semibold mt-4 mb-2">Kontakt</h2>
        <p>
          E-Mail:{' '}
          <a href="mailto:[DEINE E-MAIL ADRESSE]" className="text-blue-500 underline">
            [DEINE E-MAIL ADRESSE]
          </a>
          <br />
          {/* Optional: Telefon: [DEINE NUMMER] */}
        </p>

        <h2 className="text-xl font-semibold mt-4 mb-2">
          Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV
        </h2>
        <p>
          [DEIN VORNAME] [DEIN NACHNAME]
          <br />
          [DEINE ADRESSE WIE OBEN]
        </p>

        <h2 className="text-xl font-semibold mt-4 mb-2">Streitschlichtung</h2>
        <p>
          Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS)
          bereit:
          <a
            href="https://ec.europa.eu/consumers/odr"
            target="_blank"
            rel="noreferrer"
            className="text-blue-500 ml-1"
          >
            https://ec.europa.eu/consumers/odr
          </a>
          .<br />
          Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
        </p>
      </section>

      {/* --- DATENSCHUTZ --- */}
      <section>
        <h1 className="text-3xl font-bold mb-6">Datenschutzerklärung</h1>

        <h2 className="text-2xl font-semibold mt-6 mb-3">1. Datenschutz auf einen Blick</h2>
        <h3 className="text-lg font-bold mt-2">Allgemeine Hinweise</h3>
        <p className="mb-2">
          Die folgenden Hinweise geben einen einfachen Überblick darüber, was mit Ihren
          personenbezogenen Daten passiert, wenn Sie unsere App "Blyve" nutzen.
          Personenbezogene Daten sind alle Daten, mit denen Sie persönlich identifiziert werden
          können (z.&nbsp;B. Name, E-Mail, Fotos).
        </p>

        <h2 className="text-2xl font-semibold mt-6 mb-3">2. Hosting und Infrastruktur</h2>
        <p className="mb-2">
          Wir hosten unsere Anwendung bei externen Dienstleistern. Die personenbezogenen Daten,
          die auf dieser App erfasst werden, werden auf den Servern dieser Dienstleister
          gespeichert.
        </p>

        <h3 className="text-lg font-bold mt-4">Vercel</h3>
        <p className="mb-2">
          Unsere Web-Applikation wird gehostet von Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA
          91789, USA.
          <br />
          Vercel stellt die technische Infrastruktur bereit, um die App auszuliefern.
          Serverstandort für unsere Deployments ist vorrangig Frankfurt (EU), jedoch können Daten
          technisch bedingt auch in den USA verarbeitet werden.
        </p>

        <h3 className="text-lg font-bold mt-4">Supabase</h3>
        <p className="mb-2">
          Als Backend-Datenbank und für die Benutzerauthentifizierung nutzen wir Supabase Inc.,
          970 Toa Payoh N, #07-04, Singapur 319000.
          <br />
          Die Datenbank-Server befinden sich in Frankfurt, Deutschland (EU-Region).
          <br />
          Supabase speichert für uns:
        </p>
        <ul className="list-disc pl-5 mb-2">
          <li>Login-Daten (E-Mail, verschlüsseltes Passwort)</li>
          <li>Profil-Daten (z.&nbsp;B. Anzeigename, Nutzername, Bio)</li>
          <li>Bilder (Avatare im Supabase Storage)</li>
          <li>Chat-Nachrichten, Freundschaften und Gruppen</li>
        </ul>

        <h2 className="text-2xl font-semibold mt-6 mb-3">3. Datenerfassung in unserer App</h2>

        <h3 className="text-lg font-bold mt-4">Kommunikation &amp; Inhalte</h3>
        <p className="mb-2">
          Blyve ist eine Kommunikations-App (Chats, Freundschaften, Gruppen). Es werden keine
          Standortdaten zur Profil- oder Kontaktsuche erhoben. Sprach- und Videoanrufe können
          später über separate Dienste (z.&nbsp;B. LiveKit) erfolgen; gesonderte Hinweise folgen dann
          vor Aktivierung dieser Funktionen.
        </p>

        <h2 className="text-2xl font-semibold mt-6 mb-3">4. Ihre Rechte</h2>
        <h3 className="text-lg font-bold mt-4">Löschung des Accounts</h3>
        <p className="mb-2">
          Sie haben das Recht, Ihren Account jederzeit vollständig zu löschen. Dies können Sie
          direkt in den App-Einstellungen unter "Account löschen" tun. Dabei werden Ihre
          Profildaten, Bilder und Chats unwiderruflich aus unserer Datenbank und dem
          Speicher entfernt.
        </p>

        <h3 className="text-lg font-bold mt-4">Widerruf und Auskunft</h3>
        <p className="mb-2">
          Sie haben jederzeit das Recht auf unentgeltliche Auskunft über Ihre gespeicherten
          personenbezogenen Daten, deren Herkunft und Empfänger und den Zweck der
          Datenverarbeitung sowie ein Recht auf Berichtigung oder Löschung dieser Daten.
        </p>
      </section>
    </div>
  );
};

export default LegalDocs;
