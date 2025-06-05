import { z } from 'zod'

// Schema for exercise question data
export const ExerciseQuestionSchema = z.object({
  question: z.object({
    de: z.string(),
    fr: z.string()
  }),
  word_to_translate: z.string(),
  correct_answer: z.string(),
  options: z.array(z.string())
})

// Schema for exercise data
export const ExerciseDataSchema = z.object({
  type: z.literal('multiple_choice_pair'),
  level: z.enum(['beginner', 'intermediate', 'advanced']).default('intermediate'),
  de_to_fr: ExerciseQuestionSchema,
  fr_to_de: ExerciseQuestionSchema
})

// Schema for pronunciation data
export const PronunciationSchema = z.object({
  file: z.string(),
  type: z.string(),
  language: z.string()
})

// Complete vocabulary item schema
export const VocabularyItemSchema = z.object({
  word: z.string(),
  exercises: ExerciseDataSchema.optional(),
  pronunciations: z.array(PronunciationSchema).optional()
})

export type ExerciseQuestion = z.infer<typeof ExerciseQuestionSchema>
export type ExerciseData = z.infer<typeof ExerciseDataSchema>
export type PronunciationData = {
  file: string
  type: string
  language: string
}
