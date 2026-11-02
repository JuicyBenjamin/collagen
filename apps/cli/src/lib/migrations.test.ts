import { describe, expect, it } from "vitest";
import { isMigration, schemaChanges } from "./migrations";

const lines = (text: string) => text.split("\n");
const rows = (file: string, text: string) => schemaChanges(file, lines(text))?.map((change) => [change.action, change.table, change.target ?? "", change.detail ?? "", change.losesData ? "loses data" : ""].join(" | "));

describe("a migration read as what it does to the schema", () => {
  it("is known by its folder", () => {
    expect(["db/migrate/20240101_add_email.rb", "prisma/migrations/20240101_init/migration.sql", "shop/migrations/0002_book_isbn.py", "database/migrations/2024_01_01_create_users_table.php", "src/migrations.ts", "docs/migrate.md"].map(isMigration)).toEqual([true, true, true, true, false, false]);
  });

  it("reads SQL: tables made, columns changed, indexes, and what loses data", () => {
    const sql = `-- CreateTable
CREATE TABLE "User" (
  "id" SERIAL NOT NULL,
  "email" TEXT NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Post" ADD COLUMN "slug" TEXT, DROP COLUMN "legacy", ALTER COLUMN "views" SET DATA TYPE BIGINT;
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
DROP TABLE "Old";`;
    expect(rows("prisma/migrations/1_init/migration.sql", sql)).toEqual([
      "create table | User |  | id, email | ",
      "add column | Post | slug | TEXT | ",
      "drop column | Post | legacy |  | loses data",
      "change column | Post | views | type BIGINT | loses data",
      "add unique index | User | User_email_key | email | ",
      "drop table | Old |  |  | loses data",
    ]);
  });

  it("reads Rails, forward only: its way back is not what runs", () => {
    const rails = `class AddEmail < ActiveRecord::Migration[7.1]
  def up
    create_table :accounts do |t|
      t.string :name
      t.references :user
      t.timestamps
    end
    add_column :users, :email, :string
    remove_column :users, :nickname
  end

  def down
    drop_table :accounts
  end
end`;
    expect(rows("db/migrate/20240101_add_email.rb", rails)).toEqual(["create table | accounts |  | name, user_id, created_at, updated_at | ", "add column | users | email | string | ", "drop column | users | nickname |  | loses data"]);
  });

  it("reads Django's operations and Laravel's schema calls", () => {
    const django = `class Migration(migrations.Migration):
    operations = [
        migrations.AddField(model_name='book', name='isbn', field=models.CharField(max_length=13)),
        migrations.RemoveField(model_name='book', name='blurb'),
    ]`;
    expect(rows("shop/migrations/0002_book_isbn.py", django)).toEqual(["add column | book | isbn | CharField | ", "drop column | book | blurb |  | loses data"]);
    const laravel = `return new class extends Migration {
    public function up(): void {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('email')->unique();
            $table->timestamps();
        });
    }
    public function down(): void {
        Schema::dropIfExists('users');
    }
};`;
    expect(rows("database/migrations/2024_01_01_create_users_table.php", laravel)).toEqual(["create table | users |  | id, email, created_at, updated_at | "]);
  });
});
