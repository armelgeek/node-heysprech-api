CREATE TYPE "public"."exercise_type" AS ENUM('multiple_choice_pair');--> statement-breakpoint
CREATE TYPE "public"."language_direction" AS ENUM('de_to_fr', 'fr_to_de');--> statement-breakpoint
CREATE TYPE "public"."language_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TABLE "exercise_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_id" integer NOT NULL,
	"option_text" varchar(255) NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "exercise_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"exercise_id" integer NOT NULL,
	"direction" "language_direction" NOT NULL,
	"question_de" text NOT NULL,
	"question_fr" text NOT NULL,
	"word_to_translate" varchar(255) NOT NULL,
	"correct_answer" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" serial PRIMARY KEY NOT NULL,
	"word_id" integer NOT NULL,
	"type" "exercise_type" NOT NULL,
	"level" "language_level" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pronunciations" (
	"id" serial PRIMARY KEY NOT NULL,
	"word_id" integer NOT NULL,
	"file_path" varchar(1000) NOT NULL,
	"type" varchar(50) NOT NULL,
	"language" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "word_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"word" varchar(255) NOT NULL,
	"language" varchar(10) NOT NULL,
	"translations" jsonb NOT NULL,
	"examples" jsonb NOT NULL,
	"level" "language_level" NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "exercise_options" ADD CONSTRAINT "exercise_options_question_id_exercise_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."exercise_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_questions" ADD CONSTRAINT "exercise_questions_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pronunciations" ADD CONSTRAINT "pronunciations_word_id_word_entries_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."word_entries"("id") ON DELETE cascade ON UPDATE no action;