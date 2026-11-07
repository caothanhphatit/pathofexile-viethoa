return {
  baseitemtypes = {
    [1] = { name = "Id", type = "String", list = false, width = 8 },
    [2] = { name = "Name", type = "String", list = false, width = 8 },
    [3] = { name = "Category", type = "String", list = false, width = 8 }
  },
  skillgems = {
    [1] = { name = "Id", type = "String", list = false, width = 8 },
    [2] = { name = "Name", type = "String", list = false, width = 8 },
    [3] = { name = "Tags", type = "String", list = true, width = 16 },
    [4] = { name = "Level", type = "Int", list = false, width = 4 },
    [5] = { name = "Quality", type = "Int", list = false, width = 4 },
    [6] = { name = "Support", type = "Bool", list = false, width = 1 }
  },
  mods = {
    [1] = { name = "Id", type = "String", list = false, width = 8 },
    [2] = { name = "Name", type = "String", list = false, width = 8 },
    [3] = { name = "Text", type = "String", list = false, width = 8 }
  }
}
