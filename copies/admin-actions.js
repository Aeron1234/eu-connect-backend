"use server";

import { getUserSession } from "./services";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { revalidatePath } from "next/cache";

// DONE
export async function createUser(prevState, formData) {
  const connection = await db.getConnection();

  try {
    const session = await getUserSession();
    if (!session?.user || session.user.role !== "admin") {
      throw new Error("Unauthorized");
    }

    const userData = Object.fromEntries(formData);
    const { email, password, first_name, last_name, course, role } = userData;

    // ROLES : 1 = Student, 2 = Employer, 3 = Department Head, 4 = Admin
    const roleId = Number(role);

    const requiredFields = [
      "email",
      "first_name",
      "last_name",
      "password",
      "role",
    ];
    for (const field of requiredFields) {
      if (!userData[field] || userData[field].trim() === "") {
        throw new Error(`${field.replace(/_/g, " ")} is required.`);
      }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("Invalid email format.");

    if (password.length < 8)
      throw new Error("Password must be at least 8 characters.");

    if (roleId === 1 || roleId === 3) {
      if (!course) {
        throw new Error("Course is required for this role.");
      }
    }

    await connection.beginTransaction();

    // Check if exists
    const [userExists] = await connection.execute(
      `SELECT id FROM users WHERE email = ?`,
      [email],
    );
    if (userExists.length > 0) throw new Error("User already exists.");

    const hashedPassword = await bcrypt.hash(password, 10);
    const newId = uuidv4();

    await connection.execute(
      `INSERT INTO users (id, email, password_hash, role_id) VALUES (?, ?, ?, ?)`,
      [newId, email, hashedPassword, roleId],
    );

    await connection.execute(
      `INSERT INTO user_profiles (user_id, first_name, last_name) VALUES (?, ?, ?)`,
      [newId, first_name, last_name],
    );

    if (roleId === 1 || roleId === 3) {
      await connection.execute(
        `INSERT INTO student_academic_info (user_id, course_id) VALUES (?, ?)`,
        [newId, Number(course)],
      );
    }

    await connection.commit();

    revalidatePath("/admin/accounts");
    return { success: true, message: "Account created successfully!" };
  } catch (err) {
    await connection.rollback(); // Undo everything if it fails
    console.error("Create Account Error: ", err.message);
    return { success: false, error: err.message };
  } finally {
    connection.release();
  }
}

// DONE
export async function deactivateAccount(prevState, formData) {
  const connection = await db.getConnection();

  try {
    const session = await getUserSession();
    if (!session?.user || session.user.role !== "admin") {
      throw new Error("Unauthorized");
    }

    if (!formData || typeof formData.get !== "function") {
      throw new Error("Invalid form submission.");
    }

    const accountId = formData.get("accountId");
    if (!accountId) throw new Error("Account ID is missing.");

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `UPDATE users SET status = 'inactive', deleted_at = NOW() WHERE id = ?`,
      [accountId],
    );

    if (result.affectedRows === 0) {
      throw new Error("Deactivation failed. Account not found.");
    }

    await connection.commit();

    revalidatePath("/admin/accounts");
    return { success: true, message: "Account deactivated." };
  } catch (err) {
    await connection.rollback(); // Undo everything if it fails
    console.error("Deactivation Account Error: ", err.message);
    return { success: false, error: err.message };
  } finally {
    connection.release();
  }
}

// DONE
export async function reactivateAccount(prevState, formData) {
  const connection = await db.getConnection();

  try {
    const session = await getUserSession();
    if (!session?.user || session.user.role !== "admin") {
      throw new Error("Unauthorized");
    }

    if (!formData || typeof formData.get !== "function") {
      throw new Error("Invalid form submission.");
    }

    const accountId = formData.get("accountId");
    if (!accountId) throw new Error("Account ID is missing.");

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `UPDATE users SET status = 'active', deleted_at = null WHERE id = ?`,
      [accountId],
    );

    if (result.affectedRows === 0) {
      throw new Error("Reactivation failed. Account not found.");
    }

    await connection.commit();

    revalidatePath("/admin/accounts");
    return { success: true, message: "Account reactivated." };
  } catch (err) {
    await connection.rollback(); // Undo everything if it fails
    console.error("Reactivation Account Error: ", err.message);
    return { success: false, error: err.message };
  } finally {
    connection.release();
  }
}
