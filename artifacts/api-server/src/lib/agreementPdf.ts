/**
 * Forensic Inspection Purchase & Sale Agreement — server-side PDF generator.
 *
 * Generates a self-contained PDF using pdfkit. The output contains:
 *   1. Agreement header (property, parties, date, inspection ID)
 *   2. Agreement body (terms of the forensic inspection engagement)
 *   3. Homeowner signature (embedded base64 PNG from the device canvas)
 *   4. Audit block (inspector, timestamp, document version, session info)
 *
 * Document version "1.0" — bump when the agreement text changes materially so
 * signed_agreements rows can always be tied back to the exact terms agreed to.
 */

import PDFDocument from 'pdfkit';

export const AGREEMENT_DOCUMENT_VERSION = '1.0';

export interface AgreementParams {
  inspectionId: string;
  propertyAddress: string;
  homeownerName: string;
  inspectorName: string;
  companyName: string;
  signedAt: Date;
  signatureImageBase64: string; // raw base64 (no data: prefix)
  inspectorUserId: string;
  userAgent?: string | null;
}

const BRAND_BLUE = '#0f2942';
const MUTED = '#718096';
const BORDER = '#e2e8f0';

/** Full agreement body text. Bump AGREEMENT_DOCUMENT_VERSION when this changes. */
function agreementBody(params: AgreementParams): string[] {
  return [
    `This Forensic Inspection Purchase & Sale Agreement ("Agreement") is entered into on ` +
      `${formatDate(params.signedAt)} by and between:`,
    `• Property Owner / Authorized Representative: ${params.homeownerName}`,
    `• Inspection Company: ${params.companyName}`,
    `• Property Address: ${params.propertyAddress}`,
    '',
    '1. SCOPE OF SERVICES',
    `The Property Owner hereby authorizes ${params.companyName} to conduct a full forensic roof ` +
      `and exterior inspection of the above-referenced property. The inspection shall document ` +
      `all observable storm-related or weather-related damage to the roof system, siding, ` +
      `gutters, windows, collateral structures, and any affected interior areas. The inspection ` +
      `findings will be compiled into a documented, photo-backed proof package.`,
    '',
    '2. AUTHORIZATION',
    `The Property Owner confirms they are the owner of the property or have lawful authority to ` +
      `authorize this inspection on behalf of the owner. By signing below, the Property Owner ` +
      `grants ${params.companyName} personnel permission to access the property, including the ` +
      `roof, exterior, and interior spaces (where applicable), for the purpose of conducting the ` +
      `forensic inspection.`,
    '',
    '3. PURPOSE OF INSPECTION',
    `The forensic inspection is conducted to document existing conditions and storm-related ` +
      `damage. The findings are compiled to support an insurance claim process. This Agreement ` +
      `and the resulting inspection report do not constitute a guarantee of insurance coverage, ` +
      `a repair estimate, or a warranty of any kind.`,
    '',
    '4. PHOTO DOCUMENTATION',
    `The Property Owner consents to photo and video documentation of the property during the ` +
      `inspection. All documentation is used solely for the purpose of compiling the forensic ` +
      `proof package and supporting any related insurance claim or legal proceeding.`,
    '',
    '5. ACCURACY OF INFORMATION',
    `The Property Owner acknowledges that all information provided to ${params.companyName} ` +
      `regarding the property, prior claims, prior repairs, and date of loss is accurate and ` +
      `complete to the best of their knowledge.`,
    '',
    '6. NO LEGAL OR FINANCIAL ADVICE',
    `Nothing in this Agreement or the resulting inspection report constitutes legal advice, ` +
      `financial advice, or a determination of insurance coverage. The Property Owner is ` +
      `advised to consult with their insurance carrier and independent legal counsel as needed.`,
    '',
    '7. ELECTRONIC SIGNATURE',
    `The parties agree that an electronic or digital signature applied to this document is ` +
      `legally binding and has the same force and effect as a handwritten signature under the ` +
      `Electronic Signatures in Global and National Commerce Act (E-SIGN Act, 15 U.S.C. § 7001 ` +
      `et seq.) and the Uniform Electronic Transactions Act (UETA), as applicable.`,
  ];
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateTime(d: Date): string {
  return (
    d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
  );
}

/**
 * Generates the agreement PDF and returns its binary Buffer.
 * Throws if the signature image is invalid or PDF generation fails.
 */
export async function generateAgreementPdf(params: AgreementParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 54, bottom: 54, left: 54, right: 54 },
      info: {
        Title: 'Forensic Inspection Purchase & Sale Agreement',
        Author: params.companyName,
        Subject: `Inspection ID: ${params.inspectionId}`,
        CreationDate: params.signedAt,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = 612 - 108; // LETTER width minus left+right margins
    const accentBlue = BRAND_BLUE;

    // ── Header ────────────────────────────────────────────────────────────────
    doc.rect(54, 54, pageWidth, 66).fill(accentBlue);

    doc
      .fillColor('#9fb3c8')
      .fontSize(8)
      .font('Helvetica-Bold')
      .text('FORENSIC INSPECTION PURCHASE & SALE AGREEMENT', 66, 64, { characterSpacing: 0.8 });

    doc
      .fillColor('#ffffff')
      .fontSize(16)
      .font('Helvetica-Bold')
      .text(params.propertyAddress || 'Property', 66, 78, { width: pageWidth - 80 });

    doc
      .fillColor('rgba(255,255,255,0.75)')
      .fontSize(9)
      .font('Helvetica')
      .text(`Inspection ID: ${params.inspectionId}`, 66, 106);

    // Date stamp at top-right of header
    doc
      .fillColor('#9fb3c8')
      .fontSize(8)
      .font('Helvetica-Bold')
      .text(formatDate(params.signedAt), 66, 64, { align: 'right', width: pageWidth - 12 });

    doc.moveDown(2.5);

    // ── Agreement body ────────────────────────────────────────────────────────
    const paragraphs = agreementBody(params);
    let firstParagraph = true;

    for (const para of paragraphs) {
      if (para === '') {
        doc.moveDown(0.4);
        continue;
      }

      const isSection = /^\d+\./.test(para);
      const isBullet = para.startsWith('•');

      if (isSection) {
        doc
          .fillColor(accentBlue)
          .fontSize(9)
          .font('Helvetica-Bold')
          .text(para, { continued: false });
        doc.moveDown(0.2);
      } else if (isBullet) {
        doc
          .fillColor('#1a202c')
          .fontSize(9)
          .font('Helvetica')
          .text(para, { indent: 10 });
        doc.moveDown(0.15);
      } else {
        if (!firstParagraph) doc.moveDown(0.3);
        doc
          .fillColor('#1a202c')
          .fontSize(9)
          .font('Helvetica')
          .text(para, { align: 'justify', lineGap: 2 });
        firstParagraph = false;
      }
    }

    // ── Signature block ───────────────────────────────────────────────────────
    doc.moveDown(1.5);

    const sigY = doc.y;
    // Divider
    doc
      .moveTo(54, sigY)
      .lineTo(54 + pageWidth, sigY)
      .strokeColor(BORDER)
      .lineWidth(0.5)
      .stroke();

    doc.moveDown(0.8);

    doc
      .fillColor(MUTED)
      .fontSize(8)
      .font('Helvetica-Bold')
      .text('HOMEOWNER SIGNATURE', { characterSpacing: 0.6 });

    doc.moveDown(0.3);

    // Embed the signature image
    try {
      const sigBuffer = Buffer.from(params.signatureImageBase64, 'base64');
      const sigImageY = doc.y;
      const sigBoxWidth = 220;
      const sigBoxHeight = 70;

      doc
        .rect(54, sigImageY, sigBoxWidth, sigBoxHeight)
        .strokeColor(BORDER)
        .lineWidth(0.5)
        .stroke();

      doc.image(sigBuffer, 58, sigImageY + 4, {
        width: sigBoxWidth - 8,
        height: sigBoxHeight - 8,
        fit: [sigBoxWidth - 8, sigBoxHeight - 8],
        align: 'center',
        valign: 'center',
      });

      doc.y = sigImageY + sigBoxHeight + 4;
    } catch (imgErr) {
      // Signature embedding MUST succeed — a signed agreement without a real
      // signature image is legally invalid. Surface the error to the caller so
      // the route can reject the request instead of persisting a bad record.
      doc.end();
      throw new Error(
        `Signature image could not be embedded in the PDF: ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`,
      );
    }

    doc.moveDown(0.4);
    doc
      .fillColor('#1a202c')
      .fontSize(9)
      .font('Helvetica-Bold')
      .text(params.homeownerName);

    doc
      .fillColor(MUTED)
      .fontSize(8)
      .font('Helvetica')
      .text(`Signed: ${formatDateTime(params.signedAt)}`);

    // ── Audit block ───────────────────────────────────────────────────────────
    doc.moveDown(1.2);

    const auditY = doc.y;
    doc
      .rect(54, auditY, pageWidth, 56)
      .fillAndStroke('#f7fafc', BORDER);

    doc.y = auditY + 8;

    doc
      .fillColor(MUTED)
      .fontSize(7.5)
      .font('Helvetica-Bold')
      .text('AUDIT RECORD', 64, undefined, { characterSpacing: 0.5 });

    doc.moveDown(0.3);
    doc
      .fillColor('#4a5568')
      .fontSize(8)
      .font('Helvetica')
      .text(
        [
          `Document version: ${AGREEMENT_DOCUMENT_VERSION}`,
          `Inspection ID: ${params.inspectionId}`,
          `Inspector: ${params.inspectorName} (user ID: ${params.inspectorUserId})`,
          `Signed at: ${params.signedAt.toISOString()} UTC`,
          params.userAgent ? `Device: ${params.userAgent.slice(0, 100)}` : null,
        ]
          .filter(Boolean)
          .join('   ·   '),
        64,
        undefined,
        { width: pageWidth - 20, lineGap: 2 },
      );

    // ── Footer disclaimer ─────────────────────────────────────────────────────
    const pageBottom = 54 + 10 * 72; // ~bottom of LETTER minus margins
    doc
      .fillColor(MUTED)
      .fontSize(7)
      .font('Helvetica')
      .text(
        'This document was generated electronically and constitutes a legally binding agreement ' +
          'under the E-SIGN Act and UETA. The signature above was captured on the inspection ' +
          "device at the time of signing and is stored as part of the inspection's permanent record.",
        54,
        pageBottom - 20,
        { width: pageWidth, align: 'justify' },
      );

    doc.end();
  });
}
