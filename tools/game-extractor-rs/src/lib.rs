#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ColumnType {
    Bool,
    Int,
    UInt16,
    UInt,
    Float,
    String,
    ShortKey,
    Key,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnSpec {
    pub name: String,
    pub column_type: ColumnType,
    pub list: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DatValue {
    Bool(bool),
    Int(i32),
    UInt16(u16),
    UInt(u32),
    Float(f32),
    String(String),
    ShortKey(u64),
    Key { lo: u64, hi: u64 },
    List(Vec<DatValue>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct DatRow {
    pub values: Vec<(String, DatValue)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Dat64Table {
    pub row_count: u32,
    pub row_size: usize,
    pub rows: Vec<DatRow>,
}

pub fn value_size(column_type: &ColumnType) -> usize {
    match column_type {
        ColumnType::Bool => 1,
        ColumnType::Int => 4,
        ColumnType::UInt16 => 2,
        ColumnType::UInt => 4,
        ColumnType::Float => 4,
        ColumnType::String => 8,
        ColumnType::ShortKey => 8,
        ColumnType::Key => 16,
    }
}

pub fn column_width(column: &ColumnSpec) -> usize {
    if column.list {
        16
    } else {
        value_size(&column.column_type)
    }
}

pub fn parse_dat64(raw: &[u8], spec: &[ColumnSpec]) -> Result<Dat64Table, String> {
    if raw.len() < 12 {
        return Err("DAT64 payload is too small".to_string());
    }

    let row_count = read_u32(raw, 0)? as usize;
    let marker_index = find_marker(raw, 4).ok_or_else(|| "DAT64 marker not found".to_string())?;
    if row_count == 0 {
        return Ok(Dat64Table {
            row_count: 0,
            row_size: 0,
            rows: Vec::new(),
        });
    }

    let row_bytes = marker_index
        .checked_sub(4)
        .ok_or_else(|| "DAT64 marker appears before row data".to_string())?;
    if row_bytes % row_count != 0 {
        return Err("DAT64 row data is not divisible by row count".to_string());
    }
    let row_size = row_bytes / row_count;
    let expected_row_size: usize = spec.iter().map(column_width).sum();
    if row_size != expected_row_size {
        return Err(format!(
            "DAT64 row size mismatch: got {row_size}, expected {expected_row_size}"
        ));
    }

    let mut rows = Vec::with_capacity(row_count);
    for row_index in 0..row_count {
        let row_start = 4 + row_index * row_size;
        let mut offset = 0usize;
        let mut values = Vec::with_capacity(spec.len());
        for column in spec {
            let cell_offset = row_start + offset;
            let value = if column.list {
                let count = read_u64(raw, cell_offset)? as usize;
                let list_offset = marker_index + read_u64(raw, cell_offset + 8)? as usize;
                let item_size = value_size(&column.column_type);
                let mut items = Vec::with_capacity(count);
                for index in 0..count {
                    items.push(read_scalar(
                        raw,
                        list_offset + index * item_size,
                        &column.column_type,
                        marker_index,
                    )?);
                }
                DatValue::List(items)
            } else {
                read_scalar(raw, cell_offset, &column.column_type, marker_index)?
            };
            values.push((column.name.clone(), value));
            offset += column_width(column);
        }
        rows.push(DatRow { values });
    }

    Ok(Dat64Table {
        row_count: row_count as u32,
        row_size,
        rows,
    })
}

fn find_marker(raw: &[u8], start: usize) -> Option<usize> {
    raw.windows(8)
        .enumerate()
        .skip(start)
        .find(|(_, window)| window.iter().all(|byte| *byte == 0xbb))
        .map(|(index, _)| index)
}

fn read_scalar(
    raw: &[u8],
    offset: usize,
    column_type: &ColumnType,
    marker_index: usize,
) -> Result<DatValue, String> {
    match column_type {
        ColumnType::Bool => Ok(DatValue::Bool(*raw.get(offset).unwrap_or(&0) == 1)),
        ColumnType::Int => Ok(DatValue::Int(read_i32(raw, offset)?)),
        ColumnType::UInt16 => Ok(DatValue::UInt16(read_u16(raw, offset)?)),
        ColumnType::UInt => Ok(DatValue::UInt(read_u32(raw, offset)?)),
        ColumnType::Float => Ok(DatValue::Float(read_f32(raw, offset)?)),
        ColumnType::String => {
            let string_offset = read_u64(raw, offset)? as usize;
            Ok(DatValue::String(read_utf16_string(
                raw,
                marker_index + string_offset,
            )?))
        }
        ColumnType::ShortKey => Ok(DatValue::ShortKey(read_u64(raw, offset)?)),
        ColumnType::Key => Ok(DatValue::Key {
            lo: read_u64(raw, offset)?,
            hi: read_u64(raw, offset + 8)?,
        }),
    }
}

fn read_utf16_string(raw: &[u8], offset: usize) -> Result<String, String> {
    let mut units = Vec::new();
    let mut index = offset;
    while index + 1 < raw.len() {
        let unit = u16::from_le_bytes([raw[index], raw[index + 1]]);
        if unit == 0 {
            break;
        }
        units.push(unit);
        index += 2;
    }
    String::from_utf16(&units).map_err(|error| error.to_string())
}

fn read_u16(raw: &[u8], offset: usize) -> Result<u16, String> {
    let bytes = raw
        .get(offset..offset + 2)
        .ok_or_else(|| format!("offset {offset} is out of range for u16"))?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_i32(raw: &[u8], offset: usize) -> Result<i32, String> {
    let bytes = raw
        .get(offset..offset + 4)
        .ok_or_else(|| format!("offset {offset} is out of range for i32"))?;
    Ok(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_u32(raw: &[u8], offset: usize) -> Result<u32, String> {
    let bytes = raw
        .get(offset..offset + 4)
        .ok_or_else(|| format!("offset {offset} is out of range for u32"))?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_u64(raw: &[u8], offset: usize) -> Result<u64, String> {
    let bytes = raw
        .get(offset..offset + 8)
        .ok_or_else(|| format!("offset {offset} is out of range for u64"))?;
    Ok(u64::from_le_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ]))
}

fn read_f32(raw: &[u8], offset: usize) -> Result<f32, String> {
    let bytes = raw
        .get(offset..offset + 4)
        .ok_or_else(|| format!("offset {offset} is out of range for f32"))?;
    Ok(f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put_u64(buffer: &mut [u8], offset: usize, value: u64) {
        buffer[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }

    #[test]
    fn parses_fixture_dat64_string_int_bool_and_list() {
        let spec = vec![
            ColumnSpec {
                name: "Id".to_string(),
                column_type: ColumnType::String,
                list: false,
            },
            ColumnSpec {
                name: "Level".to_string(),
                column_type: ColumnType::Int,
                list: false,
            },
            ColumnSpec {
                name: "Enabled".to_string(),
                column_type: ColumnType::Bool,
                list: false,
            },
            ColumnSpec {
                name: "Tags".to_string(),
                column_type: ColumnType::String,
                list: true,
            },
        ];

        let row_size = 29usize;
        let marker_index = 4 + row_size;
        let mut raw = vec![0u8; marker_index + 8];
        raw[0..4].copy_from_slice(&1u32.to_le_bytes());
        raw[marker_index..marker_index + 8].fill(0xbb);

        let skill_offset = 8u64;
        put_u64(&mut raw, 4, skill_offset);
        raw[12..16].copy_from_slice(&12i32.to_le_bytes());
        raw[16] = 1;

        let list_offset = 8 + "SkillOne".encode_utf16().count() * 2 + 2;
        put_u64(&mut raw, 17, 2);
        put_u64(&mut raw, 25, list_offset as u64);

        let mut data = Vec::new();
        for unit in "SkillOne".encode_utf16() {
            data.extend(unit.to_le_bytes());
        }
        data.extend(0u16.to_le_bytes());
        let fire_offset = 8 + data.len() + 16;
        let spell_offset = fire_offset + "fire".encode_utf16().count() * 2 + 2;
        data.extend((fire_offset as u64).to_le_bytes());
        data.extend((spell_offset as u64).to_le_bytes());
        for unit in "fire".encode_utf16() {
            data.extend(unit.to_le_bytes());
        }
        data.extend(0u16.to_le_bytes());
        for unit in "spell".encode_utf16() {
            data.extend(unit.to_le_bytes());
        }
        data.extend(0u16.to_le_bytes());
        raw.extend(data);

        let table = parse_dat64(&raw, &spec).expect("fixture parses");
        assert_eq!(table.row_count, 1);
        assert_eq!(table.row_size, 29);
        assert!(matches!(&table.rows[0].values[0].1, DatValue::String(value) if value == "SkillOne"));
        assert!(matches!(&table.rows[0].values[3].1, DatValue::List(values) if values.len() == 2));
    }
}
