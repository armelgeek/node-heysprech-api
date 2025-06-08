CREATE TYPE "public"."video_category" AS ENUM('vocabulary', 'grammar', 'conversation', 'pronunciation', 'culture', 'news', 'other');--> statement-breakpoint
CREATE TYPE "public"."video_difficulty" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."category_type" AS ENUM('video', 'exercise');--> statement-breakpoint
CREATE TABLE "completed_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"segment_id" integer NOT NULL,
	"completed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "exercise_completions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exercise_id" integer NOT NULL,
	"video_id" integer NOT NULL,
	"score" integer NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"total_xp" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"last_activity" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_vocabulary" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"word_id" integer NOT NULL,
	"video_id" integer NOT NULL,
	"mastery_level" integer DEFAULT 0 NOT NULL,
	"next_review" timestamp,
	"last_reviewed" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_exercises" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"segment_id" integer,
	"type" text NOT NULL,
	"question_de" text NOT NULL,
	"question_fr" text,
	"correct_answer" text NOT NULL,
	"options" jsonb,
	"difficulty_level" integer DEFAULT 1 NOT NULL,
	"points" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"video_id" integer NOT NULL,
	"watched_seconds" integer DEFAULT 0 NOT NULL,
	"last_segment_watched" integer,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_exercises" integer DEFAULT 0 NOT NULL,
	"mastered_words" integer DEFAULT 0 NOT NULL,
	"last_watched" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"start_time" integer NOT NULL,
	"end_time" integer NOT NULL,
	"transcript_de" text NOT NULL,
	"transcript_fr" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_words" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"segment_id" integer,
	"word_de" text NOT NULL,
	"word_fr" text NOT NULL,
	"context_de" text,
	"context_fr" text,
	"difficulty_level" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "difficulty_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"rank" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "difficulty_levels_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "video_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" "category_type" DEFAULT 'video' NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "video_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "video_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "category" "video_category" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "difficulty" "video_difficulty" DEFAULT 'intermediate' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "youtube_id" varchar(11);--> statement-breakpoint
ALTER TABLE "completed_segments" ADD CONSTRAINT "completed_segments_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completed_segments" ADD CONSTRAINT "completed_segments_segment_id_audio_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."audio_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_completions" ADD CONSTRAINT "exercise_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_completions" ADD CONSTRAINT "exercise_completions_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_completions" ADD CONSTRAINT "exercise_completions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD CONSTRAINT "user_vocabulary_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD CONSTRAINT "user_vocabulary_word_id_video_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."video_words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD CONSTRAINT "user_vocabulary_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_exercises" ADD CONSTRAINT "video_exercises_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_exercises" ADD CONSTRAINT "video_exercises_segment_id_video_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."video_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_progress" ADD CONSTRAINT "video_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_progress" ADD CONSTRAINT "video_progress_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_progress" ADD CONSTRAINT "video_progress_last_segment_watched_video_segments_id_fk" FOREIGN KEY ("last_segment_watched") REFERENCES "public"."video_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_segments" ADD CONSTRAINT "video_segments_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_words" ADD CONSTRAINT "video_words_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_words" ADD CONSTRAINT "video_words_segment_id_video_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."video_segments"("id") ON DELETE set null ON UPDATE no action;