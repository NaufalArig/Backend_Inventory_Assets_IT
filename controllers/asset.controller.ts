import { Request, Response } from 'express';
import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import ExcelJS from "exceljs";
import { Buffer } from "buffer";

interface Asset extends RowDataPacket {
  id: number;
  name: string;
  asset_number: string;
  serial_number: string;
  category: string;
  model: string;
  type: string;
  computer_name: string;
  owner_name: string;
  owner_department: string;
  location: string;
  purchase_date: string;
  value: number;
  status: string;
  distribution_status: string;
  notes: string;
  description: string;
  created_at: string;
  updated_at: string;
}

// ===== HELPER FUNCTIONS =====
function parseDateHelper(dateStr: any): string | null {
  if (!dateStr || dateStr.toString().trim() === '') {
    return null;
  }

  const cleanStr = dateStr.toString().trim();

  try {
    // Jika sudah berupa Date object
    if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
      const year = dateStr.getFullYear();
      const month = String(dateStr.getMonth() + 1).padStart(2, '0');
      const day = String(dateStr.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // Try to parse with Date constructor
    const date = new Date(cleanStr);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // Try common formats
    // YYYY-MM-DD
    const ymdMatch = cleanStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (ymdMatch) {
      const year = ymdMatch[1];
      const month = ymdMatch[2].padStart(2, '0');
      const day = ymdMatch[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = cleanStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmyMatch) {
      const day = dmyMatch[1].padStart(2, '0');
      const month = dmyMatch[2].padStart(2, '0');
      const year = dmyMatch[3];
      return `${year}-${month}-${day}`;
    }

    return null;
  } catch (error) {
    console.error('Date parse error:', cleanStr, error);
    return null;
  }
}

function parseCurrencyHelper(valueStr: string | number): number {
  if (!valueStr && valueStr !== 0) return 0;

  try {
    if (typeof valueStr === 'number') {
      return valueStr;
    }

    const cleanStr = valueStr.toString()
      .replace(/[^\d.,-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.')
      .trim();

    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : num;
  } catch (error) {
    console.error('Currency parse error:', valueStr, error);
    return 0;
  }
}

function calculateHeaderScore(line: string): number {
  let score = 0;
  const lowerLine = line.toLowerCase();

  const keywords = [
    'asset', 'name', 'number', 'serial', 'category',
    'model', 'type', 'computer', 'owner', 'department',
    'location', 'purchase', 'date', 'value', 'status',
    'distribution', 'notes', 'description', 'created'
  ];

  keywords.forEach(keyword => {
    if (lowerLine.includes(keyword)) score += 10;
  });

  const commaCount = (line.match(/,/g) || []).length;
  const tabCount = (line.match(/\t/g) || []).length;
  score += Math.max(commaCount, tabCount) * 5;

  const numberMatch = line.match(/\b\d+\b/g);
  if (numberMatch) {
    score -= numberMatch.length * 20;
  }

  return score;
}

function validateAssetDataHelper(assetData: any, lineNumber: number): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!assetData.name || assetData.name.trim() === '') {
    errors.push(`Line ${lineNumber}: Asset name is required`);
  }

  if (!assetData.asset_number || assetData.asset_number.trim() === '') {
    errors.push(`Line ${lineNumber}: Asset number is required`);
  }

  if (!assetData.serial_number || assetData.serial_number.trim() === '') {
    errors.push(`Line ${lineNumber}: Serial number is required`);
  }

  if (!assetData.category || assetData.category.trim() === '') {
    errors.push(`Line ${lineNumber}: Category is required`);
  }

  const validCategories = ['laptop', 'desktop', 'tablet', 'printer', 'accessories', 'other'];
  if (assetData.category && !validCategories.includes(assetData.category.toLowerCase())) {
    errors.push(`Line ${lineNumber}: Invalid category "${assetData.category}". Valid categories: ${validCategories.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// ===== MAIN FUNCTIONS =====

export const getAllAssets = async (req: Request, res: Response) => {
  try {
    console.log('=== GET ASSETS REQUEST ===');
    console.log('Query params:', req.query);

    const { page = 1, limit = 10, category, status, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `
      SELECT a.*, u.name as assigned_to_name, 
             creator.name as created_by_name
      FROM assets a 
      LEFT JOIN users u ON a.assigned_to = u.id 
      LEFT JOIN users creator ON a.created_by = creator.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (category) {
      query += ' AND a.category = ?';
      params.push(category);
      console.log('Filtering by category:', category);
    }

    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
      console.log('Filtering by status:', status);
    }

    if (search) {
      query += ' AND (a.name LIKE ? OR a.description LIKE ? OR a.asset_number LIKE ? OR a.serial_number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      console.log('Searching for:', search);
    }

    query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), offset);

    console.log('Executing query:', query);
    console.log('With params:', params);

    const [assets] = await pool.query<Asset[]>(query, params);

    console.log('Found assets:', assets.length);

    let countQuery = 'SELECT COUNT(*) as total FROM assets WHERE 1=1';
    const countParams: any[] = [];

    if (category) {
      countQuery += ' AND category = ?';
      countParams.push(category);
    }

    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }

    if (search) {
      countQuery += ' AND (name LIKE ? OR description LIKE ? OR asset_number LIKE ? OR serial_number LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [countResult] = await pool.query<RowDataPacket[]>(countQuery, countParams);
    const total = countResult[0].total;

    console.log('Total assets:', total);

    res.json({
      success: true,
      assets,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error: any) {
    console.error('Get assets error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

export const getAssetById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [assets] = await pool.query<Asset[]>(
      `SELECT a.*, u.name as assigned_to_name, 
       creator.name as created_by_name
       FROM assets a 
       LEFT JOIN users u ON a.assigned_to = u.id
       LEFT JOIN users creator ON a.created_by = creator.id
       WHERE a.id = ?`,
      [id]
    );

    if (assets.length === 0) {
      return res.status(404).json({ message: 'Asset not found' });
    }

    res.json(assets[0]);
  } catch (error) {
    console.error('Get asset error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const createAsset = async (req: Request, res: Response) => {
  try {
    console.log('=== CREATE ASSET REQUEST ===');
    console.log('Request body:', req.body);
    console.log('User:', (req as any).user);

    const {
      name,
      asset_number,
      serial_number,
      category,
      model,
      type,
      computer_name,
      owner_name,
      owner_department,
      location,
      purchase_date,
      purchase_value,
      status = 'use',
      distribution_status = 'available',
      notes,
      description
    } = req.body;

    const userId = (req as any).user.userId;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Asset name is required'
      });
    }

    if (!asset_number) {
      return res.status(400).json({
        success: false,
        message: 'Asset number is required'
      });
    }

    if (!serial_number) {
      return res.status(400).json({
        success: false,
        message: 'Serial number is required'
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Category is required'
      });
    }

    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM assets WHERE asset_number = ? OR serial_number = ?',
      [asset_number, serial_number]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Asset number or serial number already exists'
      });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO assets 
      (name, asset_number, serial_number, category, model, type, 
       computer_name, owner_name, owner_department, location, 
       purchase_date, value, status, distribution_status, notes, 
       description, created_by) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        asset_number,
        serial_number,
        category,
        model || null,
        type || null,
        computer_name || null,
        owner_name || null,
        owner_department || null,
        location || null,
        purchase_date || null,
        purchase_value || 0,
        status,
        distribution_status,
        notes || null,
        description || null,
        userId
      ]
    );

    console.log('Asset created with ID:', result.insertId);

    await pool.query(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [userId, 'Created new asset', 'asset', result.insertId, JSON.stringify({
        name,
        asset_number,
        category
      })]
    );

    res.status(201).json({
      success: true,
      message: 'Asset created successfully',
      assetId: result.insertId
    });
  } catch (error: any) {
    console.error('Create asset error:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'Asset with this number or serial already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create asset',
      error: error.message
    });
  }
};

// ===== IMPORT FUNCTION =====
export const importAssets = async (req: Request, res: Response) => {
  try {
    console.log('=== START IMPORT ASSETS ===');

    if (!req.file) {
      console.log('No file uploaded');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const userId = (req as any).user?.userId;
    console.log('User ID:', userId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    console.log('File info:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    let importedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];
    const assetsData: any[] = [];

    const fileBuffer: Buffer = Buffer.from(req.file.buffer);
    const fileName = req.file.originalname.toLowerCase();

    // PROCESS EXCEL FILE
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      console.log('Processing Excel file with XLSX library');

      try {
        if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
          console.log('Processing Excel file with ExcelJS');

          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(fileBuffer.buffer as ArrayBuffer);

          const worksheet = workbook.getWorksheet(1);

          if (!worksheet) {
            return res.status(400).json({
              success: false,
              message: 'Worksheet not found'
            });
          }

          const headers: string[] = [];
          const headerRow = worksheet.getRow(1);

          headerRow.eachCell((cell, colNumber) => {
            headers[colNumber - 1] = cell.value
              ? cell.value.toString().trim().toLowerCase()
              : '';
          });

          console.log('Excel headers:', headers);

          worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // skip header

            const assetData: any = {
              status: 'use',
              distribution_status: 'available',
              purchase_value: 0
            };

            row.eachCell((cell, colNumber) => {
              const header = headers[colNumber - 1];
              const value = cell.value ? cell.value.toString().trim() : '';

              switch (header) {
                case 'asset name':
                  assetData.name = value;
                  break;
                case 'asset number':
                  assetData.asset_number = value;
                  break;
                case 'serial number':
                  assetData.serial_number = value;
                  break;
                case 'category':
                  assetData.category = value.toLowerCase();
                  break;
                case 'model':
                  assetData.model = value;
                  break;
                case 'type':
                  assetData.type = value;
                  break;
                case 'computer name':
                  assetData.computer_name = value;
                  break;
                case 'owner name':
                  assetData.owner_name = value;
                  break;
                case 'owner department':
                  assetData.owner_department = value;
                  break;
                case 'location':
                  assetData.location = value;
                  break;
                case 'purchase date':
                  assetData.purchase_date = parseDateHelper(value);
                  break;
                case 'purchase value':
                  assetData.purchase_value = parseCurrencyHelper(value);
                  break;
                case 'status':
                  assetData.status = value.toLowerCase() || 'use';
                  break;
                case 'distribution status':
                  assetData.distribution_status =
                    value.toLowerCase().replace(/\s+/g, '_') || 'available';
                  break;
                case 'notes':
                  assetData.notes = value;
                  break;
              }
            });

            assetsData.push(assetData);
          });

          console.log(`Total rows parsed: ${assetsData.length}`);
        }


      } catch (excelError: any) {
        console.error('Excel processing error:', excelError);
        return res.status(400).json({
          success: false,
          message: 'Failed to process Excel file',
          error: excelError.message
        });
      }
    }
    // PROCESS CSV FILE
    else if (fileName.endsWith('.csv')) {
      console.log('Processing CSV file');

      try {
        const fileContent = fileBuffer.toString("utf-8");

        let cleanContent = fileContent
          .replace(/^\uFEFF/, '')
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .trim();

        const lines = cleanContent.split('\n').filter(line => line.trim() !== '');

        if (lines.length < 2) {
          return res.status(400).json({
            success: false,
            message: 'CSV file is empty or has only headers'
          });
        }

        let headerLineIndex = 0;
        let bestHeaderScore = 0;

        for (let i = 0; i < Math.min(5, lines.length); i++) {
          const score = calculateHeaderScore(lines[i]);
          if (score > bestHeaderScore) {
            bestHeaderScore = score;
            headerLineIndex = i;
          }
        }

        const headerLine = lines[headerLineIndex];
        const headers = headerLine.split(',').map(h => h.trim().toLowerCase());

        console.log('CSV headers:', headers);

        const dataLines = lines.slice(headerLineIndex + 1);

        for (let i = 0; i < dataLines.length; i++) {
          const line = dataLines[i];
          const values = line.split(',').map(v => v.trim());

          if (values.length !== headers.length) {
            const errorMsg = `Line ${headerLineIndex + i + 2}: Column mismatch`;
            console.log(errorMsg);
            skippedCount++;
            errors.push(errorMsg);
            continue;
          }

          const assetData: any = {};

          for (let j = 0; j < headers.length; j++) {
            const header = headers[j];
            const value = values[j];

            if (header.includes('asset') && header.includes('name')) {
              assetData.name = value;
            } else if (header.includes('asset') && header.includes('number')) {
              assetData.asset_number = value;
            } else if (header.includes('serial') && header.includes('number')) {
              assetData.serial_number = value;
            } else if (header.includes('category')) {
              assetData.category = value.toLowerCase();
            } else if (header.includes('purchase') && header.includes('date')) {
              assetData.purchase_date = parseDateHelper(value);
            } else if (header.includes('purchase') && header.includes('value')) {
              assetData.purchase_value = parseCurrencyHelper(value);
            } else if (header.includes('status')) {
              assetData.status = value.toLowerCase() || 'use';
            }
          }

          if (!assetData.status) assetData.status = 'use';
          if (!assetData.distribution_status) assetData.distribution_status = 'available';

          console.log(`CSV row ${i + 1}:`, assetData);
          assetsData.push(assetData);
        }

        console.log(`Total CSV rows processed: ${assetsData.length}`);

      } catch (csvError: any) {
        console.error('CSV processing error:', csvError);
        return res.status(400).json({
          success: false,
          message: 'Failed to process CSV file',
          error: csvError.message
        });
      }
    }
    else {
      return res.status(400).json({
        success: false,
        message: 'Unsupported file format. Please upload .xlsx or .csv file'
      });
    }

    // VALIDATE AND IMPORT TO DATABASE
    console.log(`\n=== VALIDATING AND IMPORTING ${assetsData.length} ASSETS ===`);

    for (let i = 0; i < assetsData.length; i++) {
      const assetData = assetsData[i];
      const lineNumber = i + 2;

      console.log(`\n--- Processing asset ${i + 1} of ${assetsData.length} ---`);
      console.log('Asset data:', assetData);

      try {
        const validationResult = validateAssetDataHelper(assetData, lineNumber);

        if (!validationResult.isValid) {
          console.log('Validation failed:', validationResult.errors);
          skippedCount++;
          errors.push(...validationResult.errors);
          continue;
        }

        console.log(`Checking duplicates for: ${assetData.asset_number} / ${assetData.serial_number}`);
        const [existing] = await pool.query<RowDataPacket[]>(
          'SELECT id, asset_number, serial_number FROM assets WHERE asset_number = ? OR serial_number = ?',
          [assetData.asset_number, assetData.serial_number]
        );

        if (existing.length > 0) {
          const dup = existing[0];
          const errorMsg = `Row ${lineNumber}: Asset already exists (Asset: ${dup.asset_number}, Serial: ${dup.serial_number})`;
          console.log(errorMsg);
          skippedCount++;
          errors.push(errorMsg);
          continue;
        }

        const insertData = [
          assetData.name.trim(),
          assetData.asset_number.trim(),
          assetData.serial_number.trim(),
          assetData.category.trim().toLowerCase(),
          assetData.model?.trim() || null,
          assetData.type?.trim() || null,
          assetData.computer_name?.trim() || null,
          assetData.owner_name?.trim() || null,
          assetData.owner_department?.trim() || null,
          assetData.location?.trim() || null,
          assetData.purchase_date || null,
          assetData.purchase_value || 0,
          assetData.status || 'use',
          assetData.distribution_status || 'available',
          assetData.notes?.trim() || null,
          assetData.notes?.trim() || null,
          userId
        ];

        console.log('Insert data prepared:', insertData);

        const [result] = await pool.query<ResultSetHeader>(
          `INSERT INTO assets 
          (name, asset_number, serial_number, category, model, type, 
           computer_name, owner_name, owner_department, location, 
           purchase_date, value, status, distribution_status, notes, 
           description, created_by) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          insertData
        );

        console.log(`✓ Insert successful, ID: ${result.insertId}`);
        importedCount++;

      } catch (error: any) {
        console.error(`✗ Error processing row ${lineNumber}:`, error);
        skippedCount++;

        let errorMessage = `Row ${lineNumber}: `;
        if (error.code === 'ER_DUP_ENTRY') {
          errorMessage += 'Duplicate entry (asset number or serial number already exists)';
        } else if (error.code === 'ER_NO_REFERENCED_ROW_2') {
          errorMessage += 'Foreign key constraint failed';
        } else {
          errorMessage += error.message || 'Database error';
        }

        errors.push(errorMessage);
      }
    }

    console.log('\n=== IMPORT SUMMARY ===');
    console.log(`✓ Imported: ${importedCount}`);
    console.log(`✗ Skipped: ${skippedCount}`);
    console.log(`📊 Total processed: ${assetsData.length}`);

    if (errors.length > 0) {
      console.log('Errors (first 5):', errors.slice(0, 5));
    }

    if (importedCount > 0) {
      await pool.query(
        'INSERT INTO activity_log (user_id, action, entity_type, details) VALUES (?, ?, ?, ?)',
        [userId, 'Imported assets', 'asset', JSON.stringify({
          filename: req.file.originalname,
          imported: importedCount,
          skipped: skippedCount,
          totalProcessed: assetsData.length
        })]
      );
    }

    const response = {
      success: importedCount > 0,
      message: `Import completed: ${importedCount} imported, ${skippedCount} skipped`,
      imported: importedCount,
      skipped: skippedCount,
      total: assetsData.length,
      errors: errors.slice(0, 20)
    };

    console.log('Final response:', response);

    res.json(response);

  } catch (error: any) {
    console.error('✗ Import assets error:', error);
    console.error('Error stack:', error.stack);

    res.status(500).json({
      success: false,
      message: 'Server error during import',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// ===== OTHER FUNCTIONS =====
export const updateAsset = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;

    const allowedFields = [
      'name',
      'type',
      'category',
      'serial_number',
      'model',
      'computer_name',
      'owner_name',
      'owner_department',
      'location',
      'purchase_date',
      'value',
      'status',
      'distribution_status',
      'notes',
      'tags'
    ];

    const updates: any = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] =
          field === 'tags'
            ? JSON.stringify(req.body[field])
            : req.body[field];
      }
    }

    const fields = Object.keys(updates);
    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);

    await pool.query(
      `UPDATE assets SET ${setClause} WHERE id = ?`,
      [...values, id]
    );

    await pool.query(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [userId, 'Updated asset', 'asset', id, JSON.stringify(updates)]
    );

    res.json({
      success: true,
      message: 'Asset updated successfully'
    });
  } catch (error: any) {
    console.error('Update asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

export const deleteAsset = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;

    const [assets] = await pool.query<Asset[]>(
      'SELECT name, asset_number FROM assets WHERE id = ?',
      [id]
    );

    if (assets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    await pool.query('DELETE FROM assets WHERE id = ?', [id]);

    await pool.query(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [userId, 'Deleted asset', 'asset', id, JSON.stringify({
        name: assets[0].name,
        asset_number: assets[0].asset_number
      })]
    );

    res.json({
      success: true,
      message: 'Asset deleted successfully'
    });
  } catch (error: any) {
    console.error('Delete asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

export const getAssetStats = async (req: Request, res: Response) => {
  try {
    const [stats] = await pool.query<RowDataPacket[]>(`
      SELECT 
        COUNT(*) as total_assets,
        SUM(CASE WHEN status = 'use' THEN 1 ELSE 0 END) as use_assets,
        SUM(CASE WHEN status = 'broken' THEN 1 ELSE 0 END) as maintenance_assets,
        SUM(CASE WHEN status = 'stock' THEN 1 ELSE 0 END) as stock_assets,
        SUM(value) as total_value,
        SUM(CASE WHEN status = 'use' THEN value ELSE 0 END) as use_assets_value,
        SUM(CASE WHEN status = 'broken' THEN value ELSE 0 END) as maintenance_cost,
        COUNT(DISTINCT category) as categories
      FROM assets
    `);

    const result = stats[0] || {};

    res.json({
      success: true,
      total_assets: parseInt(result.total_assets) || 0,
      total_value: parseFloat(result.total_value) || 0,
      use_assets: parseInt(result.use_assets) || 0,
      maintenance_assets: parseInt(result.maintenance_assets) || 0,
      inactive_assets: parseInt(result.inactive_assets) || 0,
      retired_assets: parseInt(result.retired_assets) || 0,
      active_assets_value: parseFloat(result.active_assets_value) || 0,
      maintenance_cost: parseFloat(result.maintenance_cost) || 0,
      categories: parseInt(result.categories) || 0
    });
  } catch (error: any) {
    console.error('Get asset stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

export const getCategoryStats = async (req: Request, res: Response) => {
  try {
    const [stats] = await pool.query<RowDataPacket[]>(`
      SELECT 
        category,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'use' THEN 1 ELSE 0 END) as use,
        SUM(value) as total_value,
        AVG(value) as avg_value
      FROM assets
      GROUP BY category
      ORDER BY count DESC
    `);

    res.json({
      success: true,
      stats: stats || []
    });
  } catch (error: any) {
    console.error('Get category stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

export const exportAssets = async (req: Request, res: Response) => {
  try {
    const { type = "all", category } = req.query;
    const userId = (req as any).user.userId;

    let query = `SELECT * FROM assets WHERE 1=1`;
    let params: any[] = [];

    if (type === "category" && category) {
      query += ` AND category = ?`;
      params.push(category);
    }

    const [assets]: any = await pool.query(query, params);

    // ===== CREATE WORKBOOK =====
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Assets");

    // ===== DEFINE COLUMNS =====
    worksheet.columns = [
      { header: "Asset Name", key: "name", width: 20 },
      { header: "Asset Number", key: "asset_number", width: 18 },
      { header: "Serial Number", key: "serial_number", width: 20 },
      { header: "Category", key: "category", width: 15 },
      { header: "Model", key: "model", width: 18 },
      { header: "Type", key: "type", width: 18 },
      { header: "Computer Name", key: "computer_name", width: 20 },
      { header: "Owner Name", key: "owner_name", width: 20 },
      { header: "Owner Department", key: "owner_department", width: 22 },
      { header: "Location", key: "location", width: 22 },
      { header: "Purchase Date", key: "purchase_date", width: 15 },
      { header: "Purchase Value", key: "value", width: 18 },
      { header: "Status", key: "status", width: 15 },
      { header: "Distribution Status", key: "distribution_status", width: 18 },
      { header: "Notes", key: "notes", width: 30 },
      { header: "Created Date", key: "created_at", width: 15 },
    ];

    // ===== HEADER STYLE =====
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    // ===== ADD DATA =====
    assets.forEach((asset: any) => {
      worksheet.addRow({
        ...asset,
        purchase_date: asset.purchase_date
          ? new Date(asset.purchase_date).toISOString().split("T")[0]
          : "",
        created_at: new Date(asset.created_at)
          .toISOString()
          .split("T")[0],
      });
    });

    // ===== CENTER ALL DATA =====
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber !== 1) {
        row.eachCell((cell) => {
          cell.alignment = { vertical: "middle", horizontal: "center" };
        });
      }
    });

    // ===== AUTO FILTER =====
    const totalColumns = worksheet.columns.length;
    worksheet.autoFilter = {
      from: {
        row: 1,
        column: 1,
      },
      to: {
        row: 1,
        column: totalColumns,
      },
    };


    // ===== FREEZE HEADER =====
    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    // ===== EXPORT =====
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=assets_${type}_${new Date()
        .toISOString()
        .split("T")[0]}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error: any) {
    console.error("Export assets error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// ===== TEMPLATE DOWNLOAD FUNCTIONS =====
export const downloadTemplate = async (req: Request, res: Response) => {
  try {
    const template = `name,asset_number,serial_number,category,model,type,computer_name,owner_name,owner_department,location,purchase_date,purchase_value,status,distribution_status,notes
Laptop Dell XPS 15,ASSET-001,SN123456789,laptop,XPS 15 9520,Business Laptop,IT-DEPT-001,John Doe,IT Department,Gedung A Lantai 3,2024-01-15,15000000,use,available,High-performance laptop
Desktop HP Elite,ASSET-002,SN987654321,desktop,EliteDesk 800,Workstation,HR-DEPT-001,Jane Smith,HR Department,Gedung B Lantai 2,2024-02-20,12000000,use,assigned,Desktop computer`;

    res.setHeader('Content-Disposition', 'attachment; filename=asset_import_template.csv');
    res.setHeader('Content-Type', 'text/csv');
    res.send(template);

  } catch (error: any) {
    console.error('Download template error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download template'
    });
  }
};

export const downloadExcelTemplate = async (req: Request, res: Response) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Template');

    worksheet.columns = [
      { header: 'Asset Name', key: 'name', width: 25 },
      { header: 'Asset Number', key: 'asset_number', width: 20 },
      { header: 'Serial Number', key: 'serial_number', width: 25 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Model', key: 'model', width: 20 },
      { header: 'Type', key: 'type', width: 20 },
      { header: 'Computer Name', key: 'computer_name', width: 20 },
      { header: 'Owner Name', key: 'owner_name', width: 20 },
      { header: 'Owner Department', key: 'owner_department', width: 22 },
      { header: 'Location', key: 'location', width: 22 },
      { header: 'Purchase Date', key: 'purchase_date', width: 15 },
      { header: 'Purchase Value', key: 'purchase_value', width: 18 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Distribution Status', key: 'distribution_status', width: 20 },
      { header: 'Notes', key: 'notes', width: 30 }
    ];

    worksheet.addRow({
      name: 'Laptop Dell XPS 15',
      asset_number: 'ASSET-001',
      serial_number: 'SN123456789',
      category: 'laptop',
      model: 'XPS 15 9520',
      type: 'Business Laptop',
      computer_name: 'IT-DEPT-001',
      owner_name: 'John Doe',
      owner_department: 'IT Department',
      location: 'Gedung A Lantai 3',
      purchase_date: '2024-01-15',
      purchase_value: 15000000,
      status: 'use',
      distribution_status: 'available',
      notes: 'High-performance laptop'
    });

    worksheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=asset_import_template.xlsx'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Download Excel template error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download Excel template'
    });
  }
};