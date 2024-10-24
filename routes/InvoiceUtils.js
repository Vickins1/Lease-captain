// utils/invoiceUtils.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const nodemailer = require('nodemailer');

// Function to generate invoice PDF
const generateInvoicePDF = async (invoice, user) => {
    const doc = new PDFDocument();
    const filePath = `./invoices/invoice-${invoice.invoiceNumber}.pdf`;

    doc.pipe(fs.createWriteStream(filePath));

    doc.fontSize(16).text('Invoice', { align: 'center' });
    doc.fontSize(12).text(`Invoice Number: ${invoice.invoiceNumber}`);
    doc.text(`User: ${user.email}`);
    doc.text(`Invoice Date: ${new Date(invoice.createdAt).toLocaleDateString()}`);
    doc.text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}`);
    doc.text(`Total Amount: ${invoice.totalAmount}`);

    doc.text('Items:');
    invoice.items.forEach((item, index) => {
        doc.text(`${index + 1}. ${item.description} - Qty: ${item.quantity} - Unit Price: ${item.unitPrice} - Total: ${item.totalPrice}`);
    });

    doc.end();
    console.log('Invoice PDF generated successfully.');
    return filePath;
};

// Function to send invoice email
const sendInvoiceEmail = async (invoice, user) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: `Invoice: ${invoice.invoiceNumber}`,
        text: `Dear ${user.username},\n\nPlease find attached your invoice.`,
        attachments: [
            {
                filename: `invoice-${invoice.invoiceNumber}.pdf`,
                path: `./invoices/invoice-${invoice.invoiceNumber}.pdf`
            }
        ]
    };

    await transporter.sendMail(mailOptions);
    console.log(`Invoice email sent to ${user.email}`);
};

module.exports = { generateInvoicePDF, sendInvoiceEmail };
