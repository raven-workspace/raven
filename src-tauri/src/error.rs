use serde::ser::{Serialize, SerializeMap, Serializer};

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum AppError {
    #[error("vault is locked")]
    Locked,
    #[error("wrong password")]
    WrongPassword,
    #[error("a vault already exists")]
    VaultExists,
    #[error("no vault has been created")]
    NoVault,
    #[error("not found")]
    NotFound,
    #[error("the database file is damaged")]
    Damaged,
    #[error("{message}")]
    Validation { field: String, message: String },
    #[error("io error: {0}")]
    Io(String),
    #[error("database error: {0}")]
    Db(String),
    #[error("no NVD API key is set")]
    NoKey,
    #[error("{0}")]
    Offline(String),
    #[error("NVD refused the request (key rejected or rate-limited)")]
    KeyRejected,
    /// NVD is overloaded or rate-limiting (503/429/5xx): the machine is online, so this is not `Offline`.
    #[error("NVD is busy or unavailable; try again shortly")]
    NvdBusy,
    /// The write would replace something that must stay as it is.
    #[error("{0}")]
    Conflict(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn validation(field: &str, message: impl Into<String>) -> Self {
        AppError::Validation { field: field.into(), message: message.into() }
    }

    pub fn code(&self) -> &'static str {
        match self {
            AppError::Locked => "locked",
            AppError::WrongPassword => "wrong_password",
            AppError::VaultExists => "vault_exists",
            AppError::NoVault => "no_vault",
            AppError::NotFound => "not_found",
            AppError::Damaged => "damaged",
            AppError::Validation { .. } => "validation",
            AppError::Io(_) => "io",
            AppError::Db(_) => "db",
            AppError::NoKey => "no_key",
            AppError::Offline(_) => "offline",
            AppError::KeyRejected => "key_rejected",
            AppError::NvdBusy => "nvd_busy",
            AppError::Conflict(_) => "conflict",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let field = matches!(self, AppError::Validation { .. });
        let mut m = s.serialize_map(Some(if field { 3 } else { 2 }))?;
        m.serialize_entry("code", self.code())?;
        m.serialize_entry("message", &self.to_string())?;
        if let AppError::Validation { field, .. } = self {
            m.serialize_entry("field", field)?;
        }
        m.end()
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Db(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_with_code() {
        let e = AppError::Validation { field: "scope".into(), message: "bad".into() };
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"code":"validation","message":"bad","field":"scope"}"#
        );
    }

    #[test]
    fn error_simple_has_no_field() {
        let v = serde_json::to_value(AppError::Locked).unwrap();
        assert_eq!(v["code"], "locked");
        assert!(v.get("field").is_none());
    }

    #[test]
    fn damaged_code_and_message() {
        let v = serde_json::to_value(AppError::Damaged).unwrap();
        assert_eq!(v["code"], "damaged");
        assert_eq!(v["message"], "the database file is damaged");
    }

    #[test]
    fn nvd_error_codes() {
        assert_eq!(serde_json::to_value(AppError::NoKey).unwrap()["code"], "no_key");
        assert_eq!(serde_json::to_value(AppError::Offline("no connection to NVD".into())).unwrap()["code"], "offline");
        let v = serde_json::to_value(AppError::KeyRejected).unwrap();
        assert_eq!(v["code"], "key_rejected");
        assert_eq!(v["message"], "NVD refused the request (key rejected or rate-limited)");
        let busy = serde_json::to_value(AppError::NvdBusy).unwrap();
        assert_eq!(busy["code"], "nvd_busy");
        assert_eq!(busy["message"], "NVD is busy or unavailable; try again shortly");
    }

    #[test]
    fn conflict_code_and_message() {
        let v = serde_json::to_value(AppError::Conflict("already recorded".into())).unwrap();
        assert_eq!((v["code"].as_str(), v["message"].as_str()), (Some("conflict"), Some("already recorded")));
    }

    #[test]
    fn error_from_io() {
        let e: AppError = std::io::Error::other("boom").into();
        assert_eq!(e.code(), "io");
    }

    #[test]
    fn error_from_serde() {
        let src = serde_json::from_str::<u32>("x").unwrap_err();
        let e: AppError = serde_json::from_str::<u32>("x").unwrap_err().into();
        assert_eq!(e, AppError::Db(src.to_string()));
        assert_eq!(e.code(), "db");
    }
}
