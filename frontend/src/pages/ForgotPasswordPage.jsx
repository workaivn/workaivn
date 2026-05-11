import { useState } from "react";
              <input
                type="text"
                value={otp}
                onChange={(e) =>
                  setOtp(e.target.value)
                }
                required
                placeholder="123456"
                style={inputStyle}
              />

              <label>
                New Password
              </label>

              <input
                type="password"
                value={newPassword}
                onChange={(e) =>
                  setNewPassword(e.target.value)
                }
                required
                placeholder="New password"
                style={inputStyle}
              />

              <button
                type="submit"
                disabled={loading}
                style={buttonStyle}
              >
                {
                  loading
                    ? "Resetting..."
                    : "Reset Password"
                }
              </button>

            </form>
          )
        }

        {
          message && (
            <div
              style={{
                marginTop: 20,
                padding: 12,
                borderRadius: 10,
                background: "#f3f4f6",
                color: "#111",
              }}
            >
              {message}
            </div>
          )
        }

      </div>

    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: 14,
  marginTop: 8,
  marginBottom: 18,
  borderRadius: 10,
  border: "1px solid #ddd",
  fontSize: 16,
  boxSizing: "border-box",
};

const buttonStyle = {
  width: "100%",
  padding: 14,
  borderRadius: 10,
  border: "none",
  background: "black",
  color: "white",
  fontSize: 16,
  cursor: "pointer",
  fontWeight: 600,
};
