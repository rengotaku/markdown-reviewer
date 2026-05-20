data "external_schema" "gorm" {
  program = [
    "go",
    "run",
    "-mod=mod",
    "./atlasgen",
  ]
}

env "local" {
  src = data.external_schema.gorm.url
  dev = "sqlite://file?mode=memory&_fk=1"
  url = "sqlite://app.db?_fk=1"
  migration {
    dir = "file://migrations"
  }
}
