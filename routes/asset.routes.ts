import { Router } from 'express';
import { 
  getAllAssets, 
  getAssetById, 
  createAsset, 
  updateAsset, 
  deleteAsset,
  getAssetStats,
  getCategoryStats,
  exportAssets,
  importAssets,
  downloadTemplate,
  downloadExcelTemplate
} from '../controllers/asset.controller';
import { authenticateToken, authorizeRole } from '../middleware/auth.middleware';
import multer from 'multer';

const router = Router();

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
      'text/plain'
    ];
    
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const fileExt = file.originalname.toLowerCase().slice(-5);
    
    if (allowedMimes.includes(file.mimetype) || 
        allowedExtensions.some(ext => file.originalname.toLowerCase().endsWith(ext))) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) and CSV files are allowed'));
    }
  }
});

router.use(authenticateToken);

router.get('/', getAllAssets);
router.get('/stats', getAssetStats);
router.get('/stats/categories', getCategoryStats);
router.get('/export', exportAssets);
router.get('/template', downloadTemplate);
router.get('/template-excel', downloadExcelTemplate);
router.post('/import', upload.single('file'), importAssets);
router.get('/:id', getAssetById);
router.post('/', authorizeRole('Admin', 'Moderator'), createAsset);
router.put('/:id', authorizeRole('Admin', 'Moderator'), updateAsset);
router.delete('/:id', authorizeRole('Admin'), deleteAsset);

router.use((error: any, req: any, res: any, next: any) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 10MB'
      });
    }
    return res.status(400).json({
      success: false,
      message: `File upload error: ${error.message}`
    });
  } else if (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'File upload error'
    });
  }
  next(error);
});

export default router;