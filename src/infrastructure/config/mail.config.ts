import { env } from 'node:process'
import nodemailer from 'nodemailer'
type EmailParams = {
  to: string
  subject: string
  text: string
}

const FROM_NAME = 'Boiler Hono'
const FROM_EMAIL = 'contact@boilerhono.com'

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number.parseInt(env.SMTP_PORT || '587'),
  secure: env.SMTP_SECURE === 'true',
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD
  }
})

export const emailTemplates = {
  deleteAccount(verificationUrl: string) {
    return {
      subject: 'Confirmation de suppression de compte',
      text: `Bonjour,

Nous avons reçu une demande de suppression de votre compte BoilerHono.

Pour confirmer cette action, veuillez cliquer sur le lien suivant:
${verificationUrl}

Si vous n'êtes pas à l'origine de cette demande, veuillez ignorer ce message et contacter notre support.

Ce lien expirera dans 24 heures.

Cordialement,
L'équipe BoilerHono`
    }
  },

  verification(verificationUrl: string) {
    return {
      subject: 'Vérifiez votre adresse email',
      text: `Bonjour,

Merci de vous être inscrit à BoilerHono. Pour finaliser votre inscription, veuillez vérifier votre adresse email en cliquant sur le lien suivant:
${verificationUrl}

Ce lien expirera dans 24 heures.

Cordialement,
L'équipe BoilerHono`
    }
  },

  resetPassword(verificationUrl: string) {
    return {
      subject: 'Réinitialisation de votre mot de passe',
      text: `Bonjour,

Nous avons reçu une demande de réinitialisation de mot de passe pour votre compte BoilerHono.

Pour créer un nouveau mot de passe, veuillez cliquer sur le lien suivant:
${verificationUrl}

Si vous n'êtes pas à l'origine de cette demande, veuillez ignorer ce message.

Ce lien expirera dans 24 heures.

Cordialement,
L'équipe BoilerHono`
    }
  },

  changeEmail(verificationUrl: string) {
    return {
      subject: "Vérification du changement d'email",
      text: `Bonjour,

Nous avons reçu une demande de changement d'adresse email pour votre compte BoilerHono.

Pour confirmer cette nouvelle adresse email, veuillez cliquer sur le lien suivant:
${verificationUrl}

Si vous n'êtes pas à l'origine de cette demande, veuillez ignorer ce message et contacter notre support.

Ce lien expirera dans 24 heures.

Cordialement,
L'équipe BoilerHono`
    }
  },
  otpLogin(otpCode: string, name?: string) {
    return {
      subject: 'Code de connexion BoilerHono',
      text: `Bonjour ${name ? name : ''},
        Voici votre code de connexion à usage unique pour BoilerHono:
        
        ${otpCode}
          
        Ce code est valable pendant 10 minutes.
            
        Si vous n'avez pas demandé ce code, veuillez ignorer ce message.
          
        Cordialement,
        L'équipe BoilerHono`
    }
  }
}

export const sendEmail = async ({ to, subject, text }: EmailParams): Promise<any> => {
  const from = env.EMAIL_FROM || `${FROM_NAME} <${FROM_EMAIL}>`

  const mailOptions = {
    from,
    to,
    subject,
    text
  }

  try {
    const info = await transporter.sendMail(mailOptions)
    return info
  } catch (error) {
    console.error('Error sending email:', error)
    throw error
  }
}

export const sendVerificationEmail = ({ email, verificationUrl }: { email: string; verificationUrl: string }) => {
  const emailTemplate = emailTemplates.verification(verificationUrl)
  return sendEmail({
    to: email,
    ...emailTemplate
  })
}

export const sendResetPasswordEmail = ({ email, verificationUrl }: { email: string; verificationUrl: string }) => {
  const emailTemplate = emailTemplates.resetPassword(verificationUrl)
  return sendEmail({
    to: email,
    ...emailTemplate
  })
}

export const sendChangeEmailVerification = ({ email, verificationUrl }: { email: string; verificationUrl: string }) => {
  const emailTemplate = emailTemplates.changeEmail(verificationUrl)
  return sendEmail({
    to: email,
    ...emailTemplate
  })
}

export const sendDeleteAccountVerification = ({
  email,
  verificationUrl
}: {
  email: string
  verificationUrl: string
}) => {
  const emailTemplate = emailTemplates.deleteAccount(verificationUrl)
  return sendEmail({ to: email, ...emailTemplate })
}
