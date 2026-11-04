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
    #[error("{message}")]
    Validation { field: String, message: String },
    #[error("io error: {0}")]
    Io(String),
    #[error("database error: {0}")]
    Db(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Locked => "locked",
            AppError::WrongPassword => "wrong_password",
            AppError::VaultExists => "vault_exists",
            AppError::NoVault => "no_vault",
            AppError::NotFound => "not_found",
            AppError::Validation { .. } => "validation",
            AppError::Io(_) => "io",
            AppError::Db(_) => "db",
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
    fn error_from_io() {
        let e: AppError = std::io::Error::other("boom").into();
        assert_eq!(e.code(), "io");
    }
}
