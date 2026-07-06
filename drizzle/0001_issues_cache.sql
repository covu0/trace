CREATE TABLE "issues_cache" (
	"repo_id" integer NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"is_pull" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issues_cache_repo_id_number_pk" PRIMARY KEY("repo_id","number")
);
--> statement-breakpoint
ALTER TABLE "issues_cache" ADD CONSTRAINT "issues_cache_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;