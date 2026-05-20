import * as React from 'react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  updateDoc,
  setDoc,
  deleteDoc,
  doc,
  getDocs,
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  Timestamp 
} from 'firebase/firestore';
import { auth, db, storage } from './firebase';
import { analyzeTripPhoto, analyzeReceipts, TripData, ReceiptData } from './services/geminiService';
import { ref, uploadBytes, getDownloadURL, uploadBytesResumable } from 'firebase/storage';
import { compressImage } from './lib/utils';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { 
  Fuel, 
  Camera, 
  History, 
  TrendingUp, 
  LogOut, 
  Plus, 
  AlertCircle, 
  CheckCircle2, 
  Info,
  Bike,
  Car,
  Calendar as CalendarIcon,
  Settings,
  RefreshCw,
  Filter,
  FileText,
  AlertTriangle,
  ArrowRight,
  Receipt,
  Download,
  Eye,
  Trash2,
  Edit,
  Save,
  X,
  MessageSquarePlus,
  Copy
} from 'lucide-react';
import { format, subDays, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { motion, AnimatePresence } from 'motion/react';

interface Vehicle {
  id: string;
  userId: string;
  nickname: string;
  type: '2 Wheeler' | '4 Wheeler';
  registration: string;
  createdAt: string;
}

interface FuelLog {
  id: string;
  userId: string;
  vehicleId: string;
  timestamp: string;
  kmsSinceLastRefill: number;
  totalKms: number;
  ridingMode: string;
  rideType: 'City' | 'Highway' | 'Mixed';
  calculatedConsumption: number;
  actualQuantityFilled: number;
  fuelType: 'Standard' | 'Premium';
  discrepancy: number;
  actualConsumption: number;
  totalCost?: number;
  pricePerLiter?: number;
  tripPhoto?: string;
  receipts?: string[];
}

interface OdometerDiscrepancy {
  calculatedKms: number;
  enteredKms: number;
  presentOdometer: number;
  previousOdometer: number;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const RIDING_MODES = ['Eco', 'Rain', 'Road', 'Dynamic', 'Enduro', 'Enduro Pro', 'Normal', 'Sport', 'Comfort', 'Off-Road'];

const safeDate = (dateVal: any) => {
  if (!dateVal) return new Date();
  try {
    const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
    return isNaN(d.getTime()) ? new Date() : d;
  } catch (e) {
    return new Date();
  }
};

export default function App() {
  return <AppContent />;
}

function AppContent() {
  console.log("AppContent rendering...");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [dashboardLogs, setDashboardLogs] = useState<FuelLog[]>([]);
  const [historyLogs, setHistoryLogs] = useState<FuelLog[]>([]);
  const [orphanedLogsCount, setOrphanedLogsCount] = useState(0);
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  // User profile / regional settings
  interface UserSetting {
    distanceUnit: 'km' | 'mi';
    volumeUnit: 'L' | 'gal_us' | 'gal_uk';
    currencyUnit: string;
    consumptionUnit: 'km/L' | 'L/100km' | 'MPG (US)' | 'MPG (UK)' | 'mi/L';
    onboarded: boolean;
  }

  const [userProfile, setUserProfile] = useState<UserSetting | null>(null);
  const [showOnboardingDialog, setShowOnboardingDialog] = useState(false);

  // Feedback System States
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<'Bug' | 'Feature Request' | 'Suggestion' | 'Other'>('Suggestion');
  const [feedbackText, setFeedbackText] = useState('');
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState(false);
  const [allFeedbacks, setAllFeedbacks] = useState<any[]>([]);

  // Subscribe to feedbacks (Admins see all; users see their own)
  useEffect(() => {
    if (!user) {
      setAllFeedbacks([]);
      return;
    }

    const isAdminUser = userProfile?.role === 'admin' || user?.email === 'turbocharged9000@gmail.com';

    let q;
    try {
      q = isAdminUser 
        ? query(collection(db, 'feedbacks'), orderBy('timestamp', 'desc'))
        : query(collection(db, 'feedbacks'), where('userId', '==', user.uid), orderBy('timestamp', 'desc'));
    } catch (e) {
      // fallback if indexing/timestamp order is not active or fails
      q = isAdminUser 
        ? query(collection(db, 'feedbacks'))
        : query(collection(db, 'feedbacks'), where('userId', '==', user.uid));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fb = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAllFeedbacks(fb);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, 'feedbacks');
      } catch (e) {
        console.error("Feedback fetch subscription error:", e);
      }
    });

    return unsubscribe;
  }, [user, userProfile]);

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackText.trim()) {
      toast.error("Please describe your feedback, suggestion or bug.");
      return;
    }
    setIsFeedbackSubmitting(true);
    try {
      const payload: any = {
        category: feedbackCategory,
        text: feedbackText.trim(),
        timestamp: new Date().toISOString()
      };
      if (user) {
        payload.userId = user.uid;
        if (user.email) {
          payload.userEmail = user.email;
        }
      }
      await addDoc(collection(db, 'feedbacks'), payload);
      toast.success("Thank you! Your feedback has been stored securely.");
      setFeedbackText('');
      setShowFeedbackDialog(false);
    } catch (err: any) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'feedbacks');
      } catch (e) {
        console.error("Feedback submit error:", e);
        toast.error("Failed to submit feedback. Please try again.");
      }
    } finally {
      setIsFeedbackSubmitting(false);
    }
  };

  // Onboarding Form States
  const [obPreset, setObPreset] = useState<string>("india");
  const [obDistanceUnit, setObDistanceUnit] = useState<'km' | 'mi'>("km");
  const [obVolumeUnit, setObVolumeUnit] = useState<'L' | 'gal_us' | 'gal_uk'>("L");
  const [obCurrency, setObCurrency] = useState<string>("₹");
  const [obConsumptionUnit, setObConsumptionUnit] = useState<'km/L' | 'L/100km' | 'MPG (US)' | 'MPG (UK)' | 'mi/L'>("km/L");

  const [obVehicleName, setObVehicleName] = useState<string>("MY BIKE");
  const [obVehicleType, setObVehicleType] = useState<'2 Wheeler' | '4 Wheeler'>("2 Wheeler");
  const [obVehicleReg, setObVehicleReg] = useState<string>("");
  const [obIsSubmitting, setObIsSubmitting] = useState<boolean>(false);

  // Sync preset selections
  useEffect(() => {
    if (obPreset === "india") {
      setObDistanceUnit("km");
      setObVolumeUnit("L");
      setObCurrency("₹");
      setObConsumptionUnit("km/L");
    } else if (obPreset === "us") {
      setObDistanceUnit("mi");
      setObVolumeUnit("gal_us");
      setObCurrency("$");
      setObConsumptionUnit("MPG (US)");
    } else if (obPreset === "europe") {
      setObDistanceUnit("km");
      setObVolumeUnit("L");
      setObCurrency("€");
      setObConsumptionUnit("L/100km");
    } else if (obPreset === "uk") {
      setObDistanceUnit("mi");
      setObVolumeUnit("gal_uk");
      setObCurrency("£");
      setObConsumptionUnit("MPG (UK)");
    }
  }, [obPreset]);

  // Handle Onboarding Submit Flow
  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!obVehicleName.trim()) {
      toast.error("Please provide a nickname for your vehicle.");
      return;
    }
    setObIsSubmitting(true);
    toast.info("Configuring account & vehicle...");

    try {
      // 1. Create User Settings Document
      await setDoc(doc(db, 'users', user.uid), {
        role: 'user',
        distanceUnit: obDistanceUnit,
        volumeUnit: obVolumeUnit,
        currencyUnit: obCurrency,
        consumptionUnit: obConsumptionUnit,
        onboarded: true,
        createdAt: new Date().toISOString()
      });

      // 2. Create Their First Vehicle Document
      await addDoc(collection(db, 'vehicles'), {
        userId: user.uid,
        nickname: obVehicleName.trim().toUpperCase(),
        type: obVehicleType,
        registration: obVehicleReg.trim().toUpperCase() || 'DEFAULT',
        createdAt: new Date().toISOString()
      });

      toast.success("Account and first vehicle successfully configured!");
      setShowOnboardingDialog(false);
    } catch (err: any) {
      console.error("Error setting up login details:", err);
      toast.error(`Setup Error: ${err.message || String(err)}`);
    } finally {
      setObIsSubmitting(false);
    }
  };

  // Editing regional settings state inside settings dialog
  const [editDistanceUnit, setEditDistanceUnit] = useState<'km' | 'mi'>('km');
  const [editVolumeUnit, setEditVolumeUnit] = useState<'L' | 'gal_us' | 'gal_uk'>('L');
  const [editCurrency, setEditCurrency] = useState<string>('$');
  const [editConsumptionUnit, setEditConsumptionUnit] = useState<'km/L' | 'L/100km' | 'MPG (US)' | 'MPG (UK)' | 'mi/L'>('km/L');

  // Dynamic helper selectors
  const getDistanceUnit = () => userProfile?.distanceUnit || 'km';
  const getVolumeUnitLabel = () => {
    const v = userProfile?.volumeUnit || 'L';
    if (v === 'L') return 'Liters';
    if (v === 'gal_us') return 'Gallons (US)';
    return 'Gallons (UK)';
  };
  const getVolumeUnitCode = () => {
    const v = userProfile?.volumeUnit || 'L';
    if (v === 'L') return 'L';
    return 'gal';
  };
  const getCurrencySymbol = () => userProfile?.currencyUnit || '$';
  const getConsumptionUnit = () => userProfile?.consumptionUnit || 'km/L';

  useEffect(() => {
    const handleError = (error: ErrorEvent) => {
      console.error("Global captured error:", error);
      setHasError(true);
      setErrorInfo(error.message);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log("Auth state changed:", user?.email);
      setUser(user);
      if (!user) {
        setLoading(false);
      }
    }, (error) => {
      console.error("Auth error:", error);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setUserProfile(null);
      setShowOnboardingDialog(false);
      return;
    }

    const docRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUserProfile({
          distanceUnit: data.distanceUnit || 'km',
          volumeUnit: data.volumeUnit || 'L',
          currencyUnit: data.currencyUnit || '$',
          consumptionUnit: data.consumptionUnit || 'km/L',
          onboarded: data.onboarded ?? true
        });
        setShowOnboardingDialog(false);
      } else {
        // First-time setup!
        setUserProfile(null);
        setShowOnboardingDialog(true);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching user profile:", error);
      setLoading(false);
    });

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user) return;

    // Check for orphaned logs (logs without vehicleId)
    const q = query(
      collection(db, 'fuelLogs'),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const orphaned = snapshot.docs.filter(doc => !doc.data().vehicleId);
      setOrphanedLogsCount(orphaned.length);
    });

    return unsubscribe;
  }, [user]);

  const handleMigrateLogs = async (vehicleId: string) => {
    if (!user) return;
    
    const q = query(
      collection(db, 'fuelLogs'),
      where('userId', '==', user.uid)
    );
    
    toast.info("Migrating legacy logs...");
    try {
      const snapshot = await getDocs(q);
      const batch = snapshot.docs.filter(doc => !doc.data().vehicleId);
      
      const promises = batch.map(d => updateDoc(doc(db, 'fuelLogs', d.id), { vehicleId }));
      await Promise.all(promises);
      
      toast.success(`Successfully migrated ${batch.length} logs!`);
      setOrphanedLogsCount(0);
    } catch (error) {
      console.error("Migration error:", error);
      toast.error("Failed to migrate some logs.");
    }
  };
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [discrepancyData, setDiscrepancyData] = useState<OdometerDiscrepancy | null>(null);
  const [showDiscrepancyDialog, setShowDiscrepancyDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [refuelStep, setRefuelStep] = useState<'initial' | 'photo' | 'receipts' | 'reset' | 'form'>('initial');
  const [selectedTripPhoto, setSelectedTripPhoto] = useState<string | null>(null);
  const [selectedReceipts, setSelectedReceipts] = useState<string[]>([]);
  const [selectedLog, setSelectedLog] = useState<FuelLog | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [logToDelete, setLogToDelete] = useState<string | null>(null);
  const [showEditVehicleDialog, setShowEditVehicleDialog] = useState(false);
  const [editVehicleData, setEditVehicleData] = useState({
    nickname: '',
    registration: '',
    type: '2 Wheeler' as '2 Wheeler' | '4 Wheeler'
  });
  
  // Filtering state
  const [filterFuelType, setFilterFuelType] = useState<string>('all');
  const [filterRidingMode, setFilterRidingMode] = useState<string>('all');
  const [filterDateRange, setFilterDateRange] = useState<string>('all');

  const [dateRange, setDateRange] = useState({
    start: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd'),
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  // Form State
  const [formData, setFormData] = useState({
    kmsSinceLastRefill: '',
    totalKms: '',
    ridingMode: 'Road',
    rideType: 'Mixed' as 'City' | 'Highway' | 'Mixed',
    calculatedConsumption: '',
    actualQuantityFilled: '',
    fuelType: 'Standard' as 'Standard' | 'Premium',
    timestamp: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    totalCost: '',
    pricePerLiter: '',
  });

  const chartData = useMemo(() => {
    try {
      return [...dashboardLogs].reverse().map(log => ({
        date: format(safeDate(log.timestamp), 'MMM dd'),
        actual: parseFloat((log.actualConsumption || 0).toFixed(2)),
        calculated: parseFloat((log.calculatedConsumption || 0).toFixed(2)),
        mode: log.ridingMode || 'N/A',
        fuel: log.fuelType || 'Standard',
        discrepancy: Math.abs(log.discrepancy || 0)
      }));
    } catch (e) {
      console.error("Error calculating chart data:", e);
      return [];
    }
  }, [dashboardLogs]);

  const stats = useMemo(() => {
    try {
      const avgCons = dashboardLogs.length > 0 
        ? (dashboardLogs.reduce((acc, log) => acc + (log.actualConsumption || 0), 0) / dashboardLogs.length)
        : 0;
      
      const totLit = dashboardLogs.reduce((acc, log) => acc + (log.actualQuantityFilled || 0), 0);
      const totKms = dashboardLogs.reduce((acc, log) => acc + (log.kmsSinceLastRefill || 0), 0);
      const maxDisc = dashboardLogs.length > 0
        ? Math.max(...dashboardLogs.map(l => Math.abs(l.discrepancy || 0)))
        : 0;
      const totCost = dashboardLogs.reduce((acc, log) => acc + (log.totalCost || 0), 0);
      
      const ecoLogs = dashboardLogs.filter(l => l.ridingMode?.toLowerCase() === 'eco');
      const ecoEff = ecoLogs.length > 0 
        ? (ecoLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / ecoLogs.length)
        : 0;
        
      const nonEcoLogs = dashboardLogs.filter(l => l.ridingMode?.toLowerCase() !== 'eco' && l.ridingMode);
      const conU = getConsumptionUnit();
      const isL100 = conU === 'L/100km';
      const nonEcoAvg = nonEcoLogs.length > 0 
        ? (nonEcoLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / nonEcoLogs.length) 
        : 0;

      const ecoSav = (ecoLogs.length > 0 && nonEcoLogs.length > 0)
        ? (isL100 ? (nonEcoAvg - ecoEff) : (ecoEff - nonEcoAvg))
        : 0;

      return {
        avgConsumption: avgCons.toFixed(2),
        totalLiters: totLit.toFixed(1),
        totalKms: totKms.toFixed(0),
        maxDiscrepancy: maxDisc.toFixed(2),
        totalCost: totCost.toFixed(2),
        avgCostPerKm: totKms > 0 ? (totCost / totKms).toFixed(2) : '0.00',
        ecoEfficiency: ecoEff.toFixed(2),
        ecoSavings: ecoSav.toFixed(2)
      };
    } catch (e) {
      console.error("Error calculating stats:", e);
      return {
        avgConsumption: '0.00',
        totalLiters: '0.0',
        totalKms: '0',
        maxDiscrepancy: '0.00',
        totalCost: '0.00',
        avgCostPerKm: '0.00',
        ecoEfficiency: '0.00',
        ecoSavings: '0.00'
      };
    }
  }, [dashboardLogs]);

  const modeEfficiencyData = useMemo(() => {
    try {
      return RIDING_MODES.map(mode => {
        const modeLogs = dashboardLogs.filter(l => l.ridingMode?.toLowerCase() === mode.toLowerCase());
        const avg = modeLogs.length > 0 ? modeLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / modeLogs.length : 0;
        return { mode, actual: parseFloat(avg.toFixed(2)) };
      }).filter(d => d.actual > 0);
    } catch (e) {
      return [];
    }
  }, [dashboardLogs]);

  const fuelEfficiencyData = useMemo(() => {
    try {
      return ['Standard', 'Premium'].map(fuel => {
        const fuelLogs = dashboardLogs.filter(l => l.fuelType?.toLowerCase() === fuel.toLowerCase());
        const avg = fuelLogs.length > 0 ? fuelLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / fuelLogs.length : 0;
        return { fuel, actual: parseFloat(avg.toFixed(2)) };
      }).filter(d => d.actual > 0);
    } catch (e) {
      return [];
    }
  }, [dashboardLogs]);

  const rideTypeEfficiencyData = useMemo(() => {
    try {
      return ['City', 'Highway', 'Mixed'].map(type => {
        const typeLogs = dashboardLogs.filter(l => (l.rideType || 'Mixed').toLowerCase() === type.toLowerCase());
        const avg = typeLogs.length > 0 ? typeLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / typeLogs.length : 0;
        return { type, actual: parseFloat(avg.toFixed(2)) };
      }).filter(d => d.actual > 0);
    } catch (e) {
      return [];
    }
  }, [dashboardLogs]);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'vehicles'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const newVehicles = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Vehicle[];
      setVehicles(newVehicles);
      
      if (newVehicles.length > 0) {
        const firstVehicle = newVehicles[0];
        setSelectedVehicle(firstVehicle);
        
        // Auto-migrate orphaned logs if they exist
        if (orphanedLogsCount > 0) {
          console.log(`Auto-migrating ${orphanedLogsCount} orphaned logs to ${firstVehicle.nickname}`);
          handleMigrateLogs(firstVehicle.id);
        }
      } else {
        // Auto-create a default vehicle if none exists and they aren't onboarding
        if (userProfile && !showOnboardingDialog) {
          try {
            const docRef = await addDoc(collection(db, 'vehicles'), {
              userId: user.uid,
              nickname: 'MY BIKE',
              type: '2 Wheeler',
              registration: 'DEFAULT',
              createdAt: new Date().toISOString()
            });
            console.log("Default vehicle created:", docRef.id);
          } catch (error) {
            console.error("Error creating default vehicle:", error);
          }
        }
      }
    }, (error) => {
      console.error("Error fetching vehicles:", error);
    });

    return unsubscribe;
  }, [user, userProfile, showOnboardingDialog]);

  useEffect(() => {
    if (!user || !selectedVehicle) {
      setLogs([]);
      return;
    }

    const q = query(
      collection(db, 'fuelLogs'),
      where('userId', '==', user.uid),
      where('vehicleId', '==', selectedVehicle.id),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`Received ${snapshot.docs.length} fuel logs for vehicle ${selectedVehicle.nickname}`);
      const newLogs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FuelLog[];
      setLogs(newLogs);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, 'fuelLogs');
      } catch (e) {
        console.error("Firestore error:", e);
        toast.error("Failed to fetch logs. Check your permissions.");
      }
    });

    return unsubscribe;
  }, [user, selectedVehicle]);

  useEffect(() => {
    // Dashboard filtering (Date Range pickers)
    const dLogs = logs.filter(log => {
      if (!log.timestamp) return false;
      const logDate = safeDate(log.timestamp);
      if (isNaN(logDate.getTime())) return false;
      
      const start = safeDate(dateRange.start);
      const end = safeDate(dateRange.end);
      
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return true;

      return isWithinInterval(logDate, {
        start: startOfDay(start),
        end: endOfDay(end),
      });
    });
    setDashboardLogs(dLogs);

    // History filtering (Quick filters)
    let hLogs = [...logs];
    if (filterFuelType !== 'all') {
      hLogs = hLogs.filter(log => log.fuelType === filterFuelType);
    }
    if (filterRidingMode !== 'all') {
      hLogs = hLogs.filter(log => log.ridingMode === filterRidingMode);
    }
    if (filterDateRange !== 'all') {
      const now = new Date();
      if (filterDateRange === '7d') {
        hLogs = hLogs.filter(log => log.timestamp && safeDate(log.timestamp) >= subDays(now, 7));
      } else if (filterDateRange === '30d') {
        hLogs = hLogs.filter(log => log.timestamp && safeDate(log.timestamp) >= subDays(now, 30));
      } else if (filterDateRange === '90d') {
        hLogs = hLogs.filter(log => log.timestamp && safeDate(log.timestamp) >= subDays(now, 90));
      }
    }
    setHistoryLogs(hLogs);
  }, [logs, filterFuelType, filterRidingMode, filterDateRange, dateRange]);

  const handleExportCSV = () => {
    if (historyLogs.length === 0) {
      toast.error("No data to export");
      return;
    }

    const headers = [
      "Date", 
      `Trip ${getDistanceUnit()}`, 
      `Total ${getDistanceUnit()}`, 
      "Riding Mode", 
      "Ride Type",
      "Fuel Type", 
      `${getVolumeUnitLabel()} Filled`, 
      `Actual Consumption (${getConsumptionUnit()})`, 
      `Calculated Consumption (${getConsumptionUnit()})`, 
      "Discrepancy", 
      "Total Cost", 
      `Price Per ${getVolumeUnitCode()}`
    ];

    const rows = historyLogs.map(log => [
      format(safeDate(log.timestamp), "dd/MM/yyyy HH:mm"),
      log.kmsSinceLastRefill || 0,
      log.totalKms || 0,
      log.ridingMode || 'N/A',
      log.rideType || 'Mixed',
      log.fuelType || 'Standard',
      log.actualQuantityFilled || 0,
      (log.actualConsumption || 0).toFixed(2),
      (log.calculatedConsumption || 0).toFixed(2),
      (log.discrepancy || 0).toFixed(2),
      log.totalCost || 0,
      log.pricePerLiter || 0
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `fuel_logs_export_${format(new Date(), "yyyy-MM-dd")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("CSV exported successfully!");
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      toast.success("Logged in successfully!");
    } catch (error) {
      console.error("Login error:", error);
      toast.error("Login failed.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setSelectedVehicle(null);
      setLogs([]);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleUpdateSettings = async () => {
    if (!selectedVehicle || !user) return;
    if (!editVehicleData.nickname || !editVehicleData.registration) {
      toast.error("Please fill all fields");
      return;
    }

    try {
      // 1. Update vehicle data
      await updateDoc(doc(db, 'vehicles', selectedVehicle.id), {
        nickname: editVehicleData.nickname.trim().toUpperCase(),
        registration: editVehicleData.registration.trim().toUpperCase(),
        type: editVehicleData.type
      });

      // 2. Update user regional settings profile
      await setDoc(doc(db, 'users', user.uid), {
        distanceUnit: editDistanceUnit,
        volumeUnit: editVolumeUnit,
        currencyUnit: editCurrency,
        consumptionUnit: editConsumptionUnit,
        onboarded: true
      }, { merge: true });

      toast.success("Preferences & vehicle updated!");
      setShowEditVehicleDialog(false);
    } catch (error) {
      console.error("Error updating settings:", error);
      toast.error("Failed to update preferences & vehicle");
    }
  };

  const handleDeleteLog = async (id: string) => {
    const path = `fuelLogs/${id}`;
    try {
      await deleteDoc(doc(db, 'fuelLogs', id));
      toast.success("Log deleted successfully");
      setLogToDelete(null);
      setSelectedLog(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const handleEditLog = (log: FuelLog) => {
    setIsEditing(true);
    setEditingLogId(log.id);
    setFormData({
      kmsSinceLastRefill: log.kmsSinceLastRefill.toString(),
      totalKms: log.totalKms.toString(),
      ridingMode: log.ridingMode,
      rideType: log.rideType || 'Mixed',
      calculatedConsumption: log.calculatedConsumption.toString(),
      actualQuantityFilled: log.actualQuantityFilled.toString(),
      fuelType: log.fuelType,
      timestamp: log.timestamp,
      totalCost: (log.totalCost || 0).toString(),
      pricePerLiter: (log.pricePerLiter || 0).toString(),
    });
    setRefuelStep('form');
    setShowAddDialog(true);
    setSelectedLog(null);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    toast.info("Analyzing trip computer photo...");

    try {
      const compressedBase64 = await compressImage(file);
      setSelectedTripPhoto(compressedBase64);
      const data = await analyzeTripPhoto(compressedBase64);
      
      if (data) {
        setFormData(prev => {
          let newTimestamp = prev.timestamp;
          if (data.time) {
            const today = format(new Date(), "yyyy-MM-dd");
            newTimestamp = `${today}T${data.time}`;
          }

          return {
            ...prev,
            kmsSinceLastRefill: data.kmsSinceLastRefill?.toString() || prev.kmsSinceLastRefill,
            totalKms: data.totalKms?.toString() || prev.totalKms,
            ridingMode: data.ridingMode || prev.ridingMode,
            calculatedConsumption: data.calculatedConsumption?.toString() || prev.calculatedConsumption,
            timestamp: newTimestamp,
          };
        });
        toast.success("Trip data extracted!");
        if (!isEditing) setRefuelStep('receipts');
      } else {
        toast.error("Could not read trip data.");
        if (!isEditing) setRefuelStep('receipts');
      }
    } catch (error: any) {
      console.error("Photo analysis error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`An error occurred during photo analysis: ${errorMessage}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsAnalyzing(true);
    toast.info("Analyzing receipts...");

    try {
      const base64Promises = files.map((file: File) => compressImage(file).catch(err => {
        console.error("Compression failed for a receipt", err);
        return null;
      }));

      const results = await Promise.all(base64Promises);
      const base64s = results.filter((b): b is string => b !== null);
      
      setSelectedReceipts(prev => [...prev, ...base64s]);

      if (base64s.length === 0) throw new Error("No valid images could be processed");

      const data = await analyzeReceipts(base64s);

      if (data) {
        setFormData(prev => {
          let newTimestamp = prev.timestamp;
          if (data.date && data.time) {
            newTimestamp = `${data.date}T${data.time}`;
          }

          return {
            ...prev,
            actualQuantityFilled: data.quantity?.toString() || prev.actualQuantityFilled,
            fuelType: (data.fuelType?.toLowerCase().includes('premium') ? 'Premium' : 'Standard') as 'Standard' | 'Premium',
            totalCost: data.totalCost?.toString() || prev.totalCost,
            pricePerLiter: data.pricePerLiter?.toString() || prev.pricePerLiter,
            timestamp: newTimestamp,
          };
        });
        toast.success("Receipt data extracted!");
      } else {
        toast.error("Could not read receipt data.");
      }
    } catch (error: any) {
      console.error("Receipt analysis error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`An error occurred during receipt analysis: ${errorMessage}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getPreviousOdometer = (): number => {
    if (!logs || logs.length === 0) return 0;
    
    // Sort logs by timestamp desc
    const sorted = [...logs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    if (isEditing && editingLogId) {
      // Find the log currently being edited in the sorted list
      const index = sorted.findIndex(log => log.id === editingLogId);
      if (index !== -1 && index + 1 < sorted.length) {
        return sorted[index + 1].totalKms;
      }
    } else {
      if (sorted.length > 0) {
        return sorted[0].totalKms;
      }
    }
    return 0;
  };

  const executeSave = async (kms: number, totalKms: number) => {
    if (!user || !user.uid) {
      toast.error("You must be logged in to save logs.");
      return;
    }

    const liters = parseFloat(formData.actualQuantityFilled);
    const calcCons = parseFloat(formData.calculatedConsumption) || 0;

    if (isNaN(liters) || liters <= 0) {
      const volLab = getVolumeUnitCode() === 'L' ? "liters" : "gallons";
      toast.error(`Please enter a valid amount of ${volLab} filled.`);
      return;
    }

    const consumptionUnit = getConsumptionUnit();
    const actualConsumption = kms <= 0 ? 0 : (consumptionUnit === 'L/100km' ? ((liters / kms) * 100) : (kms / liters));
    const discrepancy = isNaN(calcCons) ? 0 : calcCons - actualConsumption;

    if (!db) {
      toast.error("Firebase services not initialized.");
      return;
    }

    setIsAnalyzing(true);
    toast.info("Saving log...");
    console.log("Starting executeSave...");

    try {
      const payload: any = {
        userId: user.uid,
        vehicleId: selectedVehicle?.id,
        timestamp: formData.timestamp,
        kmsSinceLastRefill: kms,
        totalKms: totalKms,
        ridingMode: formData.ridingMode,
        rideType: formData.rideType,
        calculatedConsumption: calcCons,
        actualQuantityFilled: liters,
        fuelType: formData.fuelType,
        actualConsumption: isFinite(actualConsumption) ? actualConsumption : 0,
        discrepancy: isFinite(discrepancy) ? discrepancy : 0,
        totalCost: parseFloat(formData.totalCost) || 0,
        pricePerLiter: parseFloat(formData.pricePerLiter) || 0,
      };

      console.log("Submitting payload to Firestore:", payload);

      if (isEditing && editingLogId) {
        const path = `fuelLogs/${editingLogId}`;
        try {
          await updateDoc(doc(db, 'fuelLogs', editingLogId), payload);
          console.log("Firestore update successful");
          toast.success("Fuel log updated!");
        } catch (error) {
          console.error("Firestore update error:", error);
          handleFirestoreError(error, OperationType.UPDATE, path);
        }
      } else {
        const path = 'fuelLogs';
        try {
          await addDoc(collection(db, 'fuelLogs'), payload);
          console.log("Firestore add successful");
          toast.success("Fuel log saved!");
        } catch (error) {
          console.error("Firestore add error:", error);
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      }

      setShowAddDialog(false);
      setIsEditing(false);
      setEditingLogId(null);
      setRefuelStep('initial');
      setSelectedTripPhoto(null);
      setSelectedReceipts([]);
      setFormData({
        kmsSinceLastRefill: '',
        totalKms: '',
        ridingMode: 'Road',
        rideType: 'Mixed',
        calculatedConsumption: '',
        actualQuantityFilled: '',
        fuelType: 'Standard',
        timestamp: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        totalCost: '',
        pricePerLiter: '',
      });
    } catch (error: any) {
      console.error("Save error:", error);
      let errorMessage = "Failed to save log. Check your permissions.";
      try {
        const errData = JSON.parse(error.message);
        errorMessage = `Firestore Error: ${errData.error}`;
      } catch (e) {
        if (error.message) errorMessage = error.message;
      }
      toast.error(errorMessage);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAnalyzing) {
      console.warn("Already submitting, ignoring request.");
      return;
    }

    if (!user || !user.uid) {
      toast.error("You must be logged in to save logs.");
      return;
    }

    const kms = parseFloat(formData.kmsSinceLastRefill);
    const totalKms = parseFloat(formData.totalKms);
    const liters = parseFloat(formData.actualQuantityFilled);

    if (isNaN(kms) || kms <= 0) {
      toast.error("Please enter valid trip Kms (greater than 0).");
      return;
    }
    if (isNaN(totalKms) || totalKms <= 0) {
      toast.error("Please enter a valid Odometer reading.");
      return;
    }
    if (isNaN(liters) || liters <= 0) {
      toast.error("Please enter actual quantity filled.");
      return;
    }

    // Previous odometer check for validation/comparison
    const previousOdometer = getPreviousOdometer();
    if (previousOdometer > 0 && totalKms > previousOdometer) {
      const calculatedKms = totalKms - previousOdometer;
      const difference = Math.abs(calculatedKms - kms);
      
      const DISCREPANCY_THRESHOLD = 5.0; // Trigger if physical difference exceeds 5 km

      if (difference > DISCREPANCY_THRESHOLD) {
        setDiscrepancyData({
          calculatedKms,
          enteredKms: kms,
          presentOdometer: totalKms,
          previousOdometer
        });
        setShowDiscrepancyDialog(true);
        return;
      }
    }

    await executeSave(kms, totalKms);
  };

  if (hasError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#E4E3E0] p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-red-600 mb-4" />
        <h1 className="text-xl font-bold text-[#141414] mb-2">Something went wrong</h1>
        <p className="text-sm text-[#141414] opacity-70 font-mono mb-4">{errorInfo}</p>
        <Button onClick={() => window.location.reload()}>Reload Page</Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#E4E3E0]">
        <RefreshCw className="w-8 h-8 animate-spin text-[#141414]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#E4E3E0] p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-2">
            <Bike className="w-16 h-16 mx-auto text-[#141414]" />
            <h1 className="text-4xl font-bold tracking-tighter text-[#141414] font-sans">FUEL TRACKER</h1>
            <p className="text-muted-foreground italic font-serif">Multi-vehicle performance monitoring</p>
          </div>
          <div className="pt-4">
            <Button onClick={handleLogin} className="w-full bg-[#141414] text-[#E4E3E0] hover:bg-[#2a2a2a] h-12 text-lg font-mono">
              SIGN IN WITH GOOGLE
            </Button>
            <p className="mt-4 text-[10px] font-mono opacity-50">
              Having trouble? <a href={window.location.href} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-100">Open in a new tab</a>
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (user && showOnboardingDialog) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#E4E3E0] p-6 text-[#141414]">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full border border-[#141414] bg-[#E4E3E0] p-6 space-y-6 shadow-sm"
        >
          <div className="border-b border-[#141414] pb-4 text-center">
            <h1 className="text-2xl font-mono uppercase tracking-widest font-bold">Account Config</h1>
            <p className="text-xs font-serif italic text-[#141414]/70 mt-1">Please configure your units & first vehicle to begin tracking.</p>
          </div>

          <form onSubmit={handleCompleteOnboarding} className="space-y-6">
            {/* Quick Country Preset */}
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-wider block text-left">Regional Preset</Label>
              <Select value={obPreset} onValueChange={setObPreset}>
                <SelectTrigger className="border-[#141414] rounded-none bg-transparent font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none">
                  <SelectItem value="india">India (Metric, ₹, km/L)</SelectItem>
                  <SelectItem value="us">United States (Imperial, $, MPG)</SelectItem>
                  <SelectItem value="europe">Europe (Metric, €, L/100km)</SelectItem>
                  <SelectItem value="uk">United Kingdom (Imperial, £, MPG UK)</SelectItem>
                  <SelectItem value="custom">Custom Configuration</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom units panel shown if Custom or as a preview */}
            <div className="p-3 bg-white/40 border border-[#141414]/10 space-y-4">
              <h2 className="text-[10px] uppercase font-mono tracking-widest text-[#141414]/60 font-bold text-left">Preferences Review</h2>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 text-left">
                  <Label className="text-[9px] font-mono uppercase opacity-50 block">Distance Unit</Label>
                  <Select 
                    disabled={obPreset !== "custom"} 
                    value={obDistanceUnit} 
                    onValueChange={(val: any) => setObDistanceUnit(val)}
                  >
                    <SelectTrigger className="border-[#141414]/30 rounded-none bg-transparent h-8 font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none">
                      <SelectItem value="km">Kilometer (km)</SelectItem>
                      <SelectItem value="mi">Mile (mi)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1 text-left">
                  <Label className="text-[9px] font-mono uppercase opacity-50 block">Volume Unit</Label>
                  <Select 
                    disabled={obPreset !== "custom"} 
                    value={obVolumeUnit} 
                    onValueChange={(val: any) => setObVolumeUnit(val)}
                  >
                    <SelectTrigger className="border-[#141414]/30 rounded-none bg-transparent h-8 font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none">
                      <SelectItem value="L">Liters (L)</SelectItem>
                      <SelectItem value="gal_us">Gallons (US)</SelectItem>
                      <SelectItem value="gal_uk">Gallons (UK)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 text-left">
                  <Label className="text-[9px] font-mono uppercase opacity-50 block">Currency Symbol</Label>
                  {obPreset === "custom" ? (
                    <Input
                      value={obCurrency}
                      onChange={e => setObCurrency(e.target.value)}
                      placeholder="e.g. $, ₹, €"
                      className="border-[#141414]/30 rounded-none bg-transparent h-8 font-mono text-xs"
                      maxLength={5}
                      required
                    />
                  ) : (
                    <div className="border border-[#141414]/20 rounded-none h-8 font-mono text-xs flex items-center px-3 bg-white/20 select-none">
                      {obCurrency}
                    </div>
                  )}
                </div>

                <div className="space-y-1 text-left">
                  <Label className="text-[9px] font-mono uppercase opacity-50 block">Fuel Economy</Label>
                  <Select 
                    disabled={obPreset !== "custom"} 
                    value={obConsumptionUnit} 
                    onValueChange={(val: any) => setObConsumptionUnit(val)}
                  >
                    <SelectTrigger className="border-[#141414]/30 rounded-none bg-transparent h-8 font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none">
                      <SelectItem value="km/L">km/L</SelectItem>
                      <SelectItem value="L/100km">L/100km</SelectItem>
                      <SelectItem value="MPG (US)">MPG (US)</SelectItem>
                      <SelectItem value="MPG (UK)">MPG (UK)</SelectItem>
                      <SelectItem value="mi/L">mi/L</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Vehicle configuration details */}
            <div className="space-y-3">
              <h2 className="text-[10px] uppercase font-mono tracking-widest text-[#141414]/60 font-bold border-t border-[#141414]/10 pt-4 text-left">First Vehicle Details</h2>
              
              <div className="space-y-2 text-left">
                <Label className="font-mono text-[10px] uppercase tracking-wider block">Nickname</Label>
                <Input 
                  value={obVehicleName}
                  onChange={e => setObVehicleName(e.target.value)}
                  placeholder="e.g. My GS, Daily Car, Highway Commuter"
                  className="border-[#141414] rounded-none bg-transparent font-mono text-xs h-9"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2 text-left">
                  <Label className="font-mono text-[10px] uppercase tracking-wider block">Vehicle Type</Label>
                  <Select value={obVehicleType} onValueChange={(val: any) => setObVehicleType(val)}>
                    <SelectTrigger className="border-[#141414] rounded-none bg-transparent font-mono text-xs h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none">
                      <SelectItem value="2 Wheeler">2 Wheeler</SelectItem>
                      <SelectItem value="4 Wheeler">4 Wheeler</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 text-left">
                  <Label className="font-mono text-[10px] uppercase tracking-wider block">Registration (Optional)</Label>
                  <Input 
                    value={obVehicleReg}
                    onChange={e => setObVehicleReg(e.target.value)}
                    placeholder="e.g. KA-01-AB-1234"
                    className="border-[#141414] rounded-none bg-transparent font-mono text-xs h-9"
                  />
                </div>
              </div>
            </div>

            <Button 
              type="submit" 
              disabled={obIsSubmitting}
              className="w-full bg-[#141414] text-[#E4E3E0] rounded-none hover:bg-[#2a2a2a] transition duration-150 py-3 uppercase font-mono tracking-wider h-12 text-xs"
            >
              {obIsSubmitting ? <RefreshCw className="animate-spin w-4 h-4 mr-2 inline" /> : null}
              Initialize Account & Vehicle
            </Button>
          </form>
        </motion.div>
      </div>
    );
  }

  if (!selectedVehicle) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#E4E3E0]">
        <div className="text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-[#141414]" />
          <p className="font-mono text-xs uppercase opacity-50">Initializing Vehicle...</p>
        </div>
      </div>
    );
  }

  const lastLog = logs[0];

  const handleStartRefuel = () => {
    setFormData(prev => ({
      ...prev,
      timestamp: format(new Date(), "yyyy-MM-dd'T'HH:mm")
    }));
    setRefuelStep('photo');
    setShowAddDialog(true);
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans pb-20">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <header className="border-b border-[#141414] bg-[#E4E3E0] sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-4">
            <div className="py-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#141414] text-[#E4E3E0] rounded-full">
                  {selectedVehicle?.type === '2 Wheeler' ? <Bike className="w-5 h-5" /> : <Car className="w-5 h-5" />}
                </div>
                <div>
                  <h1 className="text-lg font-bold tracking-tight font-mono leading-none">{selectedVehicle?.nickname?.toUpperCase()}</h1>
                  <p className="text-[10px] font-mono opacity-50 uppercase">{selectedVehicle?.registration}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  title="Submit Feedback"
                  onClick={() => setShowFeedbackDialog(true)}
                  className="hover:bg-[#14141411]"
                >
                  <MessageSquarePlus className="w-5 h-5 text-indigo-600" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => {
                    if (selectedVehicle) {
                      setEditVehicleData({
                        nickname: selectedVehicle.nickname,
                        registration: selectedVehicle.registration,
                        type: selectedVehicle.type
                      });
                      if (userProfile) {
                        setEditDistanceUnit(userProfile.distanceUnit);
                        setEditVolumeUnit(userProfile.volumeUnit);
                        setEditCurrency(userProfile.currencyUnit);
                        setEditConsumptionUnit(userProfile.consumptionUnit);
                      }
                      setShowEditVehicleDialog(true);
                    }
                  }}
                >
                  <Settings className="w-5 h-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={handleLogout}>
                  <LogOut className="w-5 h-5" />
                </Button>
              </div>
            </div>
            
            <div className="pb-4">
              <TabsList className="grid w-full grid-cols-4 bg-transparent border border-[#141414] p-1 rounded-none h-auto m-0">
                <TabsTrigger value="dashboard" className="rounded-none data-active:bg-[#141414] data-active:text-[#E4E3E0] font-mono uppercase text-[10px] py-2">Dashboard</TabsTrigger>
                <TabsTrigger value="report" className="rounded-none data-active:bg-[#141414] data-active:text-[#E4E3E0] font-mono uppercase text-[10px] py-2">Report</TabsTrigger>
                <TabsTrigger value="history" className="rounded-none data-active:bg-[#141414] data-active:text-[#E4E3E0] font-mono uppercase text-[10px] py-2">History</TabsTrigger>
                <TabsTrigger value="feedback" className="rounded-none data-active:bg-[#141414] data-active:text-[#E4E3E0] font-mono uppercase text-[10px] py-2">Feedback</TabsTrigger>
              </TabsList>
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
          <TabsContent value="dashboard" className="space-y-6 m-0 border-none outline-none focus-visible:ring-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="bg-[#141414] text-[#E4E3E0] border-none">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-orange-500" />
                    REFILL_CHECKLIST
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-1 font-mono opacity-80">
                  <p>1. PHOTO_TRIP_COMPUTER</p>
                  <p>2. NOTE_FUEL_QUANTITY</p>
                  <p>3. RESET_TRIP_COMPUTER</p>
                </CardContent>
              </Card>
              
              <Card className="border-[#141414] bg-transparent">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    LATEST_STATS
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] uppercase opacity-50 font-mono">Avg Consumption</p>
                    <p className="text-2xl font-bold font-mono">{stats.avgConsumption} <span className="text-xs">{getConsumptionUnit()}</span></p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase opacity-50 font-mono">ECO Efficiency</p>
                    <p className="text-2xl font-bold font-mono text-green-600">{stats.ecoEfficiency} <span className="text-xs">{getConsumptionUnit()}</span></p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="mt-6">
              <div className="flex flex-col sm:flex-row gap-4 items-end mb-4">
                <div className="grid grid-cols-2 gap-2 flex-1">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-mono uppercase opacity-50">Start Date</Label>
                    <Input 
                      type="date" 
                      value={dateRange.start} 
                      onChange={e => setDateRange(prev => ({...prev, start: e.target.value}))}
                      className="h-8 border-[#141414] rounded-none font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-mono uppercase opacity-50">End Date</Label>
                    <Input 
                      type="date" 
                      value={dateRange.end} 
                      onChange={e => setDateRange(prev => ({...prev, end: e.target.value}))}
                      className="h-8 border-[#141414] rounded-none font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
                <Card className="border-[#141414] bg-white/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg font-mono uppercase">Consumption Trends</CardTitle>
                <CardDescription className="font-serif italic">Actual vs Calculated Fuel Economy ({getConsumptionUnit()})</CardDescription>
              </CardHeader>
              <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#14141422" />
                    <XAxis dataKey="date" stroke="#141414" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#141414" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#141414', border: 'none', color: '#E4E3E0', fontFamily: 'monospace' }}
                      itemStyle={{ color: '#E4E3E0' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '10px', fontFamily: 'monospace' }} />
                    <Line type="monotone" dataKey="actual" stroke="#2563eb" strokeWidth={2} dot={{ r: 4, fill: '#2563eb' }} activeDot={{ r: 6 }} name="Actual" />
                    <Line type="monotone" dataKey="calculated" stroke="#dc2626" strokeWidth={1} strokeDasharray="5 5" dot={{ r: 3 }} name="Bike Calc" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               <Card className="border-[#141414] bg-white/50">
                <CardHeader>
                  <CardTitle className="text-lg font-mono uppercase">Efficiency by Mode</CardTitle>
                  <CardDescription className="text-[10px] font-mono opacity-50">Average {getConsumptionUnit()} per Riding Mode</CardDescription>
                </CardHeader>
                <CardContent className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={modeEfficiencyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#14141422" vertical={false} />
                      <XAxis dataKey="mode" stroke="#141414" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#141414" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{fill: '#14141411'}} contentStyle={{ backgroundColor: '#141414', border: 'none', color: '#E4E3E0', fontFamily: 'monospace' }} />
                      <Bar dataKey="actual" fill="#141414" radius={[4, 4, 0, 0]} name={`Avg ${getConsumptionUnit()}`} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

               <Card className="border-[#141414] bg-white/50">
                <CardHeader>
                  <CardTitle className="text-lg font-mono uppercase">Fuel Grade Impact</CardTitle>
                  <CardDescription className="text-[10px] font-mono opacity-50">Standard vs Premium Efficiency</CardDescription>
                </CardHeader>
                <CardContent className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={fuelEfficiencyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#14141422" vertical={false} />
                      <XAxis dataKey="fuel" stroke="#141414" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#141414" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{fill: '#14141411'}} contentStyle={{ backgroundColor: '#141414', border: 'none', color: '#E4E3E0', fontFamily: 'monospace' }} />
                      <Bar dataKey="actual" fill="#2563eb" radius={[4, 4, 0, 0]} name={`Avg ${getConsumptionUnit()}`} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

               <Card className="border-[#141414] bg-white/50">
                <CardHeader>
                  <CardTitle className="text-lg font-mono uppercase">Ride Type Efficiency</CardTitle>
                  <CardDescription className="text-[10px] font-mono opacity-50">City vs Highway vs Mixed Efficiency</CardDescription>
                </CardHeader>
                <CardContent className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rideTypeEfficiencyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#14141422" vertical={false} />
                      <XAxis dataKey="type" stroke="#141414" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#141414" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{fill: '#14141411'}} contentStyle={{ backgroundColor: '#141414', border: 'none', color: '#E4E3E0', fontFamily: 'monospace' }} />
                      <Bar dataKey="actual" fill="#16a34a" radius={[4, 4, 0, 0]} name={`Avg ${getConsumptionUnit()}`} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>          </div>

            <Card className="border-[#141414] bg-[#141414] text-[#E4E3E0] rounded-none">
              <CardHeader>
                <CardTitle className="font-mono uppercase tracking-widest text-sm">Ride Type Performance Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-[#E4E3E022]">
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">RIDE TYPE</TableHead>
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">AVG KM/L</TableHead>
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">TOTAL KMS</TableHead>
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">FUEL COST / KM</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {['City', 'Highway', 'Mixed'].map(type => {
                      const typeLogs = dashboardLogs.filter(l => (l.rideType || 'Mixed').toLowerCase() === type.toLowerCase());
                      if (typeLogs.length === 0) return null;
                      
                      const avg = typeLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / typeLogs.length;
                      const totalKms = typeLogs.reduce((acc, l) => acc + (l.kmsSinceLastRefill || 0), 0);
                      const totalCost = typeLogs.reduce((acc, l) => acc + (l.totalCost || 0), 0);
                      const costPerKm = totalKms > 0 ? totalCost / totalKms : 0;
                      
                      return (
                        <TableRow key={type} className="border-[#E4E3E011] hover:bg-[#E4E3E005]">
                          <TableCell className="font-mono text-[10px] uppercase font-bold">{type}</TableCell>
                          <TableCell className="font-mono text-[10px]">{avg.toFixed(2)}</TableCell>
                          <TableCell className="font-mono text-[10px]">{totalKms.toFixed(0)} {getDistanceUnit()}</TableCell>
                          <TableCell className="font-mono text-[10px] flex items-center gap-0.5">
                            <span className="font-sans leading-none">{getCurrencySymbol()}</span>
                            {costPerKm.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="border-[#141414] bg-[#141414] text-[#E4E3E0] rounded-none">
              <CardHeader>
                <CardTitle className="font-mono uppercase tracking-widest text-sm">Riding Mode Performance Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-[#E4E3E022]">
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">MODE</TableHead>
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">AVG {getConsumptionUnit()}</TableHead>
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">TOTAL {getDistanceUnit().toUpperCase()}S</TableHead>
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">FUEL COST / {getDistanceUnit().toUpperCase()}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {RIDING_MODES.map(mode => {
                      const modeLogs = dashboardLogs.filter(l => l.ridingMode?.toLowerCase() === mode.toLowerCase());
                      if (modeLogs.length === 0) return null;
                      
                      const avg = modeLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / modeLogs.length;
                      const totalKms = modeLogs.reduce((acc, l) => acc + (l.kmsSinceLastRefill || 0), 0);
                      const totalCost = modeLogs.reduce((acc, l) => acc + (l.totalCost || 0), 0);
                      const costPerKm = totalKms > 0 ? totalCost / totalKms : 0;
                      
                      return (
                        <TableRow key={mode} className="border-[#E4E3E011] hover:bg-[#E4E3E005]">
                          <TableCell className="font-mono text-[10px] uppercase font-bold">{mode}</TableCell>
                          <TableCell className="font-mono text-[10px]">{avg.toFixed(2)}</TableCell>
                          <TableCell className="font-mono text-[10px]">{totalKms.toFixed(0)} {getDistanceUnit()}</TableCell>
                          <TableCell className="font-mono text-[10px] flex items-center gap-0.5">
                            <span className="font-sans leading-none">{getCurrencySymbol()}</span>
                            {costPerKm.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="border-[#141414] bg-[#141414] text-[#E4E3E0] rounded-none">
              <CardHeader>
                <CardTitle className="font-mono uppercase tracking-widest text-sm">Performance Comparison: Standard vs Premium</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-[#E4E3E022]">
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">MODE</TableHead>
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">STD (km/L)</TableHead>
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">PREM (km/L)</TableHead>
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">IMPACT</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {RIDING_MODES.map(mode => {
                      const stdLogs = dashboardLogs.filter(l => l.fuelType?.toLowerCase() === 'standard' && l.ridingMode?.toLowerCase() === mode.toLowerCase());
                      const preLogs = dashboardLogs.filter(l => l.fuelType?.toLowerCase() === 'premium' && l.ridingMode?.toLowerCase() === mode.toLowerCase());
                      
                      if (stdLogs.length === 0 && preLogs.length === 0) return null;
                      
                      const stdAvg = stdLogs.length > 0 ? stdLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / stdLogs.length : 0;
                      const preAvg = preLogs.length > 0 ? preLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / preLogs.length : 0;
                      const diff = preAvg - stdAvg;
                      
                      return (
                        <TableRow key={mode} className="border-[#E4E3E011] hover:bg-[#E4E3E005]">
                          <TableCell className="font-mono text-[10px] uppercase font-bold">{mode}</TableCell>
                          <TableCell className="font-mono text-[10px]">{stdAvg > 0 ? stdAvg.toFixed(2) : '-'}</TableCell>
                          <TableCell className="font-mono text-[10px]">{preAvg > 0 ? preAvg.toFixed(2) : '-'}</TableCell>
                          <TableCell className={`font-mono text-[10px] font-bold ${diff > 0 ? 'text-green-400' : diff < 0 ? 'text-red-400' : ''}`}>
                            {stdAvg > 0 && preAvg > 0 ? `${diff > 0 ? '+' : ''}${diff.toFixed(2)}` : '-'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {dashboardLogs.length > 0 && RIDING_MODES.every(mode => 
                      dashboardLogs.filter(l => l.ridingMode?.toLowerCase() === mode.toLowerCase()).length === 0
                    ) && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 font-mono text-[10px] opacity-50">
                          NO_MODE_DATA_FOUND
                        </TableCell>
                      </TableRow>
                    )}
                    {dashboardLogs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 font-mono text-[10px] opacity-50">
                          NO_LOGS_AVAILABLE
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="report" className="space-y-6 m-0 border-none outline-none focus-visible:ring-0">
            <Card className="border-[#141414] bg-[#141414] text-[#E4E3E0] rounded-none">
              <CardHeader>
                <CardTitle className="font-mono uppercase tracking-widest flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Efficiency Summary Report
                </CardTitle>
                <CardDescription className="text-[#E4E3E0] opacity-60 font-mono text-xs">
                  {format(safeDate(dateRange.start), 'dd/MM/yyyy')} to {format(safeDate(dateRange.end), 'dd/MM/yyyy')}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-6 py-6 border-t border-[#E4E3E022]">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase opacity-50 font-mono">Avg Consumption</p>
                  <p className="text-2xl font-bold font-mono">{stats.avgConsumption} <span className="text-xs">km/L</span></p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] uppercase opacity-50 font-mono">Total Fuel</p>
                  <p className="text-2xl font-bold font-mono">{stats.totalLiters} <span className="text-xs">Liters</span></p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] uppercase opacity-50 font-mono">Distance Covered</p>
                  <p className="text-2xl font-bold font-mono">{stats.totalKms} <span className="text-xs">Kms</span></p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] uppercase opacity-50 font-mono">Max Discrepancy</p>
                  <p className={`text-2xl font-bold font-mono ${parseFloat(stats.maxDiscrepancy) > 0.5 ? 'text-orange-500' : ''}`}>
                    {stats.maxDiscrepancy} <span className="text-xs">km/L</span>
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] uppercase opacity-50 font-mono">ECO Advantage</p>
                  <p className="text-2xl font-bold font-mono text-green-400">
                    +{stats.ecoSavings} <span className="text-xs">km/L</span>
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#141414] bg-white/50">
              <CardHeader>
                <CardTitle className="text-lg font-mono uppercase flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                  ECO Mode Analysis
                </CardTitle>
                <CardDescription className="font-serif italic">Performance gains and cost savings using ECO mode</CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const ecoLogs = dashboardLogs.filter(l => l.ridingMode?.toLowerCase() === 'eco');
                  const nonEcoLogs = dashboardLogs.filter(l => l.ridingMode?.toLowerCase() !== 'eco' && l.ridingMode);
                  
                  if (ecoLogs.length === 0) {
                    return (
                      <div className="text-center py-8 font-mono text-[10px] opacity-50">
                        NO_ECO_DATA_AVAILABLE_FOR_ANALYSIS
                      </div>
                    );
                  }

                  const ecoAvg = ecoLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / ecoLogs.length;
                  const nonEcoAvg = nonEcoLogs.length > 0 
                    ? nonEcoLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / nonEcoLogs.length 
                    : 0;
                  
                  const conU = getConsumptionUnit();
                  const isL100 = conU === 'L/100km';
                  const improvement = nonEcoAvg > 0 
                    ? (isL100 
                       ? ((nonEcoAvg - ecoAvg) / nonEcoAvg) * 100 
                       : ((ecoAvg - nonEcoAvg) / nonEcoAvg) * 100)
                    : 0;
                  const totalEcoKms = ecoLogs.reduce((acc, l) => acc + (l.kmsSinceLastRefill || 0), 0);
                  const estimatedLitersSaved = nonEcoAvg > 0 
                    ? (isL100 
                       ? (totalEcoKms * (nonEcoAvg - ecoAvg)) / 100 
                       : (totalEcoKms / nonEcoAvg) - (totalEcoKms / ecoAvg))
                    : 0;
                  const avgPrice = dashboardLogs.reduce((acc, l) => acc + (l.pricePerLiter || 0), 0) / (dashboardLogs.filter(l => (l.pricePerLiter || 0) > 0).length || 1);
                  const estimatedMoneySaved = estimatedLitersSaved * avgPrice;

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-none">
                        <p className="text-[10px] uppercase opacity-50 font-mono">Efficiency Gain</p>
                        <p className="text-2xl font-bold font-mono text-green-700">+{improvement.toFixed(1)}%</p>
                        <p className="text-[10px] font-serif italic mt-1">vs other riding modes</p>
                      </div>
                      <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-none">
                        <p className="text-[10px] uppercase opacity-50 font-mono">Fuel Saved</p>
                        <p className="text-2xl font-bold font-mono text-green-700">{estimatedLitersSaved.toFixed(2)} {getVolumeUnitCode()}</p>
                        <p className="text-[10px] font-serif italic mt-1">estimated total savings</p>
                      </div>
                      <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-none">
                        <p className="text-[10px] uppercase opacity-50 font-mono">Money Saved</p>
                        <p className="text-2xl font-bold font-mono text-green-700 flex items-center gap-1">
                          <span className="font-sans">{getCurrencySymbol()}</span>
                          {estimatedMoneySaved.toFixed(2)}
                        </p>
                        <p className="text-[10px] font-serif italic mt-1">based on avg fuel price</p>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            <Card className="border-[#141414] bg-white/50">
              <CardHeader>
                <CardTitle className="text-lg font-mono uppercase">Cost Efficiency Analysis</CardTitle>
                <CardDescription className="font-serif italic">Cost per Kilometer by Fuel Grade and Mode</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="p-3 bg-[#141414] text-[#E4E3E0] rounded-none">
                      <p className="text-[10px] uppercase opacity-50 font-mono">Total Spent</p>
                      <p className="text-xl font-bold font-mono flex items-center gap-1">
                        <span className="font-sans text-sm leading-none">{getCurrencySymbol()}</span>
                        {stats.totalCost}
                      </p>
                    </div>
                    <div className="p-3 bg-[#141414] text-[#E4E3E0] rounded-none">
                      <p className="text-[10px] uppercase opacity-50 font-mono">Avg Cost / {getDistanceUnit()}</p>
                      <p className="text-xl font-bold font-mono flex items-center gap-1">
                        <span className="font-sans text-sm leading-none">{getCurrencySymbol()}</span>
                        {stats.avgCostPerKm}
                      </p>
                    </div>
                  </div>

                  {['Standard', 'Premium'].map(fuel => {
                    const fuelLogs = dashboardLogs.filter(l => l.fuelType === fuel && (l.totalCost || 0) > 0);
                    if (fuelLogs.length === 0) return null;
                    
                    const totalFuelCost = fuelLogs.reduce((acc, l) => acc + (l.totalCost || 0), 0);
                    const totalFuelKms = fuelLogs.reduce((acc, l) => acc + l.kmsSinceLastRefill, 0);
                    const avgCostPerKm = totalFuelKms > 0 ? (totalFuelCost / totalFuelKms).toFixed(2) : '0.00';

                    return (
                      <div key={fuel} className="space-y-3">
                        <div className="border-b border-[#14141422] pb-2">
                          <h3 className="font-mono text-sm font-bold mb-2">{fuel.toUpperCase()} COST ANALYSIS</h3>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="p-2 bg-white/40 border border-[#14141411]">
                              <p className="text-[8px] uppercase opacity-50 font-mono">Spent</p>
                              <p className="text-xs font-bold font-mono flex items-center gap-0.5">
                                <span className="font-sans text-[10px] leading-none">{getCurrencySymbol()}</span>
                                {totalFuelCost.toFixed(2)}
                              </p>
                            </div>
                            <div className="p-2 bg-white/40 border border-[#14141411]">
                              <p className="text-[8px] uppercase opacity-50 font-mono">Distance</p>
                              <p className="text-xs font-bold font-mono">{totalFuelKms.toFixed(0)} {getDistanceUnit()}</p>
                            </div>
                            <div className="p-2 bg-blue-600 text-white border border-[#14141411]">
                              <p className="text-[8px] uppercase opacity-70 font-mono">Avg Cost/{getDistanceUnit()}</p>
                              <p className="text-xs font-bold font-mono flex items-center gap-0.5">
                                <span className="font-sans text-[10px] leading-none">{getCurrencySymbol()}</span>
                                {avgCostPerKm}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {RIDING_MODES.map(mode => {
                            const modeLogs = fuelLogs.filter(l => l.ridingMode === mode);
                            if (modeLogs.length === 0) return null;
                            
                            const modeCost = modeLogs.reduce((acc, l) => acc + (l.totalCost || 0), 0);
                            const modeKms = modeLogs.reduce((acc, l) => acc + l.kmsSinceLastRefill, 0);
                            const modeAvgCost = (modeCost / modeKms).toFixed(2);
                            
                            return (
                              <div key={mode} className="p-3 border border-[#14141411] bg-white/30 rounded-sm flex justify-between items-center">
                                <span className="text-[10px] font-mono uppercase">{mode}</span>
                                <span className="text-xs font-mono font-bold flex items-center gap-0.5">
                                  <span className="font-sans text-[10px] leading-none">{getCurrencySymbol()}</span>
                                  {modeAvgCost} / {getDistanceUnit()}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#141414] bg-white/50">
              <CardHeader>
                <CardTitle className="text-lg font-mono uppercase">Ride Type Analysis</CardTitle>
                <CardDescription className="font-serif italic">Efficiency and Cost breakdown by Ride Type</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-mono text-[10px]">RIDE TYPE</TableHead>
                      <TableHead className="font-mono text-[10px]">AVG KM/L</TableHead>
                      <TableHead className="font-mono text-[10px]">BIKE CALC</TableHead>
                      <TableHead className="font-mono text-[10px]">DISCREPANCY</TableHead>
                      <TableHead className="font-mono text-[10px]">COST/KM</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {['City', 'Highway', 'Mixed'].map(type => {
                      const typeLogs = dashboardLogs.filter(l => (l.rideType || 'Mixed').toLowerCase() === type.toLowerCase());
                      if (typeLogs.length === 0) return null;
                      
                      const avg = typeLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / typeLogs.length;
                      const bikeAvg = typeLogs.reduce((acc, l) => acc + (l.calculatedConsumption || 0), 0) / typeLogs.length;
                      const disc = typeLogs.reduce((acc, l) => acc + (l.discrepancy || 0), 0) / typeLogs.length;
                      const totalKms = typeLogs.reduce((acc, l) => acc + (l.kmsSinceLastRefill || 0), 0);
                      const totalCost = typeLogs.reduce((acc, l) => acc + (l.totalCost || 0), 0);
                      const costPerKm = totalKms > 0 ? totalCost / totalKms : 0;
                      
                      return (
                        <TableRow key={type} className="hover:bg-[#14141405]">
                          <TableCell className="font-mono text-xs font-bold">{type.toUpperCase()}</TableCell>
                          <TableCell className="font-mono text-xs">{avg.toFixed(2)}</TableCell>
                          <TableCell className="font-mono text-xs">{bikeAvg.toFixed(2)}</TableCell>
                          <TableCell className={`font-mono text-xs ${Math.abs(disc) > 0.5 ? 'text-orange-600 font-bold' : ''}`}>
                            {disc > 0 ? '+' : ''}{disc.toFixed(2)}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-bold flex items-center gap-0.5">
                            <span className="font-sans text-[10px] leading-none">{getCurrencySymbol()}</span>
                            {costPerKm.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="border-[#141414] bg-white/50">
              <CardHeader>
                <CardTitle className="text-lg font-mono uppercase">Fuel & Mode Analysis</CardTitle>
                <CardDescription className="font-serif italic">Comparing Standard vs Premium across Riding Modes</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-8">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-mono text-[10px]">MODE</TableHead>
                        <TableHead className="font-mono text-[10px]">STANDARD (km/L)</TableHead>
                        <TableHead className="font-mono text-[10px]">PREMIUM (km/L)</TableHead>
                        <TableHead className="font-mono text-[10px]">IMPACT</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {RIDING_MODES.map(mode => {
                        const stdLogs = dashboardLogs.filter(l => l.fuelType?.toLowerCase() === 'standard' && l.ridingMode?.toLowerCase() === mode.toLowerCase());
                        const preLogs = dashboardLogs.filter(l => l.fuelType?.toLowerCase() === 'premium' && l.ridingMode?.toLowerCase() === mode.toLowerCase());
                        
                        if (stdLogs.length === 0 && preLogs.length === 0) return null;
                        
                        const stdAvg = stdLogs.length > 0 ? stdLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / stdLogs.length : 0;
                        const preAvg = preLogs.length > 0 ? preLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / preLogs.length : 0;
                        const diff = preAvg - stdAvg;
                        
                        return (
                          <TableRow key={mode} className="hover:bg-[#14141405]">
                            <TableCell className="font-mono text-xs font-bold">{mode.toUpperCase()}</TableCell>
                            <TableCell className="font-mono text-xs">{stdAvg > 0 ? stdAvg.toFixed(2) : 'N/A'}</TableCell>
                            <TableCell className="font-mono text-xs">{preAvg > 0 ? preAvg.toFixed(2) : 'N/A'}</TableCell>
                            <TableCell className={`font-mono text-xs font-bold ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : ''}`}>
                              {stdAvg > 0 && preAvg > 0 ? `${diff > 0 ? '+' : ''}${diff.toFixed(2)}` : '-'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {dashboardLogs.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8 font-serif italic text-muted-foreground">
                            No logs available for analysis.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>

                  {['Standard', 'Premium'].map(fuel => {
                    const fuelLogs = dashboardLogs.filter(l => l.fuelType?.toLowerCase() === fuel.toLowerCase());
                    if (fuelLogs.length === 0) return null;
                    
                    return (
                      <div key={fuel} className="space-y-3">
                        <h3 className="font-mono text-sm font-bold border-b border-[#14141422] pb-1">{fuel.toUpperCase()} FUEL PERFORMANCE</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {RIDING_MODES.map(mode => {
                            const modeLogs = fuelLogs.filter(l => l.ridingMode?.toLowerCase() === mode.toLowerCase());
                            if (modeLogs.length === 0) return null;
                            
                            const avg = (modeLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / modeLogs.length).toFixed(2);
                            const bikeAvg = (modeLogs.reduce((acc, l) => acc + (l.calculatedConsumption || 0), 0) / modeLogs.length).toFixed(2);
                            
                            return (
                              <div key={mode} className="p-3 border border-[#14141411] bg-white/30 rounded-sm">
                                <div className="flex justify-between items-center mb-2">
                                  <span className="text-[10px] font-mono font-bold uppercase">{mode}</span>
                                  <span className="text-xs font-mono font-bold">{avg} km/L</span>
                                </div>
                                <div className="space-y-1">
                                  <div className="h-1.5 w-full bg-[#14141411] rounded-full overflow-hidden">
                                    <div 
                                      className="h-full bg-blue-600" 
                                      style={{ width: `${Math.min((parseFloat(avg) / 25) * 100, 100)}%` }}
                                    />
                                  </div>
                                  <p className="text-[9px] font-mono opacity-60 text-right">Bike reported: {bikeAvg} km/L</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {dashboardLogs.length === 0 && (
                    <p className="text-center py-8 font-serif italic text-muted-foreground">Add more logs to see fuel/mode analysis.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#141414] bg-white/50">
              <CardHeader>
                <CardTitle className="text-lg font-mono uppercase">Discrepancy Analysis</CardTitle>
                <CardDescription className="font-serif italic">Flagging significant variations between bike and actual data</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {dashboardLogs.filter(l => Math.abs(l.discrepancy || 0) > 0.5).map(log => (
                    <div key={log.id} className="flex items-center justify-between p-3 border border-orange-500/30 bg-orange-500/5 font-mono">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 text-orange-500" />
                        <div>
                          <p className="text-xs font-bold">{format(safeDate(log.timestamp), 'dd/MM/yyyy')}</p>
                          <p className="text-[10px] opacity-60">Mode: {log.ridingMode} | Fuel: {log.fuelType}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-orange-600">+{ (log.discrepancy || 0).toFixed(2)} km/L</p>
                        <p className="text-[10px] opacity-60">Variance Flagged</p>
                      </div>
                    </div>
                  ))}
                  {dashboardLogs.filter(l => Math.abs(l.discrepancy || 0) > 0.5).length === 0 && (
                    <div className="flex items-center gap-3 p-4 border border-green-500/30 bg-green-500/5 font-mono text-green-700">
                      <CheckCircle2 className="w-5 h-5" />
                      <p className="text-xs">No significant discrepancies found in this period.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-6 mt-6 m-0 border-none outline-none focus-visible:ring-0">
            <div className="flex flex-col md:flex-row gap-4 mb-4 items-end">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-1">
                <div className="space-y-1">
                  <Label className="text-[10px] font-mono uppercase opacity-50">Fuel Grade</Label>
                  <Select value={filterFuelType} onValueChange={setFilterFuelType}>
                    <SelectTrigger className="h-8 border-[#141414] rounded-none font-mono text-[10px]">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="Standard">Standard</SelectItem>
                      <SelectItem value="Premium">Premium</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-mono uppercase opacity-50">Riding Mode</Label>
                  <Select value={filterRidingMode} onValueChange={setFilterRidingMode}>
                    <SelectTrigger className="h-8 border-[#141414] rounded-none font-mono text-[10px]">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none">
                      <SelectItem value="all">All</SelectItem>
                      {RIDING_MODES.map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-mono uppercase opacity-50">Date Range</Label>
                  <Select value={filterDateRange} onValueChange={setFilterDateRange}>
                    <SelectTrigger className="h-8 border-[#141414] rounded-none font-mono text-[10px]">
                      <SelectValue placeholder="All Time" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Time</SelectItem>
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                      <SelectItem value="90d">Last 90 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleExportCSV}
                    className="h-8 border-[#141414] rounded-none font-mono text-[10px] uppercase w-full"
                  >
                    <Download className="w-3 h-3 mr-2" /> Export CSV
                  </Button>
                </div>
              </div>
            </div>

            <Card className="border-[#141414] bg-white/50 overflow-hidden">
              <Table>
                <TableHeader className="bg-[#141414] text-[#E4E3E0]">
                  <TableRow className="hover:bg-[#141414]">
                    <TableHead className="text-[#E4E3E0] font-mono text-[10px]">DATE</TableHead>
                    <TableHead className="text-[#E4E3E0] font-mono text-[10px]">MODE</TableHead>
                    <TableHead className="text-[#E4E3E0] font-mono text-[10px]">RIDE</TableHead>
                    <TableHead className="text-[#E4E3E0] font-mono text-[10px]">ACTUAL</TableHead>
                    <TableHead className="text-[#E4E3E0] font-mono text-[10px]">DIFF</TableHead>
                    <TableHead className="text-[#E4E3E0] font-mono text-[10px]">FUEL</TableHead>
                    <TableHead className="text-[#E4E3E0] font-mono text-[10px] text-right">ACTIONS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyLogs.map((log) => (
                    <TableRow 
                      key={log.id} 
                      className="border-b border-[#14141422] hover:bg-[#14141411] cursor-pointer group"
                      onClick={() => setSelectedLog(log)}
                    >
                      <TableCell className="font-mono text-xs">{format(safeDate(log.timestamp), 'dd/MM/yyyy')}</TableCell>
                      <TableCell className="font-mono text-xs">{log.ridingMode}</TableCell>
                      <TableCell className="font-mono text-xs uppercase opacity-70">{log.rideType || 'Mixed'}</TableCell>
                      <TableCell className="font-mono text-xs font-bold">{(log.actualConsumption || 0).toFixed(2)}</TableCell>
                      <TableCell className={`font-mono text-xs flex items-center gap-1 ${Math.abs(log.discrepancy || 0) > 0.5 ? 'text-orange-600 font-bold' : (log.discrepancy || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {(log.discrepancy || 0) > 0 ? '+' : ''}{(log.discrepancy || 0).toFixed(2)}
                        {Math.abs(log.discrepancy || 0) > 0.5 && <AlertTriangle className="w-3 h-3" />}
                      </TableCell>
                      <TableCell className="font-mono text-[10px] uppercase opacity-70">{log.fuelType}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditLog(log);
                            }}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLogToDelete(log.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {historyLogs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 font-serif italic text-muted-foreground">No logs found for the selected range.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="feedback" className="space-y-6 m-0 border-none outline-none focus-visible:ring-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Left Column: Feedback submission card */}
              <div className="md:col-span-1 space-y-4">
                <Card className="border-[#141414] bg-[#E4E3E0]/40 backdrop-blur-sm rounded-none">
                  <CardHeader>
                    <CardTitle className="text-lg font-mono uppercase">Submit Feedback</CardTitle>
                    <CardDescription className="font-serif italic text-xs">Help us make this fuel logger even better.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleSubmitFeedback} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-mono tracking-widest block font-bold">Category</label>
                        <select
                          value={feedbackCategory}
                          onChange={(e: any) => setFeedbackCategory(e.target.value)}
                          className="w-full bg-[#E4E3E0] border border-[#141414] p-2 text-xs font-mono rounded-none"
                        >
                          <option value="Suggestion">Suggestion</option>
                          <option value="Bug">Bug Report</option>
                          <option value="Feature Request">Feature Request</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-mono tracking-widest block font-bold">Your Message</label>
                        <textarea
                          placeholder="What features would you like to see? Have you found any issues?"
                          rows={6}
                          value={feedbackText}
                          onChange={(e) => setFeedbackText(e.target.value)}
                          className="w-full bg-[#E4E3E0] border border-[#141414] p-2 text-xs font-mono rounded-none resize-none"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={isFeedbackSubmitting}
                        className="w-full cursor-pointer rounded-none bg-[#141414] text-[#E4E3E0] hover:bg-[#141414dd] font-mono text-xs uppercase py-2.5"
                      >
                        {isFeedbackSubmitting ? "Submitting..." : "Send Feedback"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </div>

              {/* Right Columns: Feedback feed */}
              <div className="md:col-span-2 space-y-4">
                <Card className="border-[#141414] bg-[#E4E3E0]/40 backdrop-blur-sm rounded-none h-full flex flex-col">
                  <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-2">
                    <div>
                      <CardTitle className="text-lg font-mono uppercase">
                        {userProfile?.role === 'admin' || user?.email === 'turbocharged9000@gmail.com' ? "All User Feedback" : "Your Submissions"}
                      </CardTitle>
                      <CardDescription className="font-serif italic text-xs">
                        {userProfile?.role === 'admin' || user?.email === 'turbocharged9000@gmail.com' 
                          ? `Consolidated database logs (${allFeedbacks.length} submissions)`
                          : `Tracking your submitted suggestions and requests (${allFeedbacks.length})`
                        }
                      </CardDescription>
                    </div>

                    {/* Admin Action: Copy Feedbacks as JSON */}
                    {(userProfile?.role === 'admin' || user?.email === 'turbocharged9000@gmail.com') && allFeedbacks.length > 0 && (
                      <Button
                        onClick={() => {
                          const simpleFeedbacks = allFeedbacks.map(f => ({
                            category: f.category,
                            text: f.text,
                            userEmail: f.userEmail || "anonymous",
                            timestamp: f.timestamp
                          }));
                          navigator.clipboard.writeText(JSON.stringify(simpleFeedbacks, null, 2));
                          toast.success("Feedback logs copied to clipboard as JSON!");
                        }}
                        size="sm"
                        className="rounded-none bg-indigo-600 hover:bg-indigo-700 text-white font-mono text-[9px] uppercase px-3.5 py-1.5 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy JSON for AI Developer
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="flex-1 overflow-y-auto max-h-[600px] space-y-3 pr-2">
                    {allFeedbacks.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center space-y-2 border border-dashed border-[#14141422] p-4">
                        <p className="font-serif italic text-sm text-[#14141499] mr-2">No feedback logs found yet.</p>
                        <p className="text-[10px] font-mono opacity-50 max-w-sm">Use the form on the left to submit suggestions, bug reports, and features you wish were in the applet!</p>
                      </div>
                    ) : (
                      allFeedbacks.map((item) => (
                        <div key={item.id} className="p-3 bg-white/60 border border-[#14141411] space-y-2 hover:bg-white/80 transition-colors">
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              {/* Category Badge */}
                              <span className={`px-2 py-0.5 text-[8px] uppercase tracking-wider font-mono border ${
                                item.category === 'Bug' 
                                  ? 'bg-red-500/10 text-red-600 border-red-500/20' 
                                  : item.category === 'Feature Request'
                                  ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
                                  : item.category === 'Suggestion'
                                  ? 'bg-purple-500/10 text-purple-600 border-purple-500/20'
                                  : 'bg-slate-500/10 text-slate-700 border-slate-500/20'
                              }`}>
                                {item.category}
                              </span>
                              
                              {/* User identifier for Admin */}
                              {(userProfile?.role === 'admin' || user?.email === 'turbocharged9000@gmail.com') && (
                                <span className="font-mono text-[9px] text-[#14141499] bg-[#1414140a] px-1.5 py-0.5" title={item.userId}>
                                  {item.userEmail || "Anonymous"}
                                </span>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-2">
                              {/* Formatted Date */}
                              <span className="font-mono text-[9px] text-[#14141499]">
                                {format(safeDate(item.timestamp), 'dd/MM/yyyy HH:mm')}
                              </span>

                              {/* Delete feedback option for Admin */}
                              {(userProfile?.role === 'admin' || user?.email === 'turbocharged9000@gmail.com') && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (confirm("Are you sure you want to delete this feedback log?")) {
                                      try {
                                        await deleteDoc(doc(db, 'feedbacks', item.id));
                                        toast.success("Feedback log deleted.");
                                      } catch (error) {
                                        console.error("Error deleting feedback:", error);
                                        toast.error("Failed to delete log.");
                                      }
                                    }
                                  }}
                                  className="text-red-600 hover:text-red-700 p-0.5 cursor-pointer"
                                  title="Delete Feedback Record"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          
                          <p className="text-xs font-serif leading-relaxed text-[#141414dd] whitespace-pre-wrap">{item.text}</p>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </main>
      </Tabs>

      {/* Log Details Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="sm:max-w-[500px] bg-[#E4E3E0] border-[#141414] rounded-none p-6 overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest border-b border-[#14141422] pb-2">Log Details: {selectedLog && format(safeDate(selectedLog.timestamp), 'dd/MM/yyyy HH:mm')}</DialogTitle>
          </DialogHeader>
          
          {selectedLog && (
            <div className="space-y-6 mt-4">
              <div className="grid grid-cols-2 gap-4 font-mono text-xs">
                <div className="p-2 bg-white/30 border border-[#14141411]">
                  <p className="opacity-50 uppercase text-[9px]">Trip Distance</p>
                  <p className="font-bold">{selectedLog.kmsSinceLastRefill} Kms</p>
                </div>
                <div className="p-2 bg-white/30 border border-[#14141411]">
                  <p className="opacity-50 uppercase text-[9px]">Odometer</p>
                  <p className="font-bold">{selectedLog.totalKms} Kms</p>
                </div>
                <div className="p-2 bg-white/30 border border-[#14141411]">
                  <p className="opacity-50 uppercase text-[9px]">Quantity Filled</p>
                  <p className="font-bold">{selectedLog.actualQuantityFilled} Liters</p>
                </div>
                <div className="p-2 bg-white/30 border border-[#14141411]">
                  <p className="opacity-50 uppercase text-[9px]">Fuel Grade</p>
                  <p className="font-bold uppercase">{selectedLog.fuelType}</p>
                </div>
                <div className="p-2 bg-white/30 border border-[#14141411]">
                  <p className="opacity-50 uppercase text-[9px]">Riding Mode</p>
                  <p className="font-bold uppercase">{selectedLog.ridingMode}</p>
                </div>
                <div className="p-2 bg-white/30 border border-[#14141411]">
                  <p className="opacity-50 uppercase text-[9px]">Ride Type</p>
                  <p className="font-bold uppercase">{selectedLog.rideType || 'Mixed'}</p>
                </div>
                <div className="p-2 bg-white/30 border border-[#14141411]">
                  <p className="opacity-50 uppercase text-[9px]">Actual Consumption</p>
                  <p className="font-bold">{(selectedLog.actualConsumption || 0).toFixed(2)} km/L</p>
                </div>
                <div className="p-2 bg-white/30 border border-[#14141411]">
                  <p className="opacity-50 uppercase text-[9px]">Bike Reported</p>
                  <p className="font-bold">{(selectedLog.calculatedConsumption || 0).toFixed(2)} km/L</p>
                </div>
                <div className={`p-2 border ${Math.abs(selectedLog.discrepancy || 0) > 0.5 ? 'bg-orange-500/10 border-orange-500/30' : 'bg-white/30 border-[#14141411]'}`}>
                  <p className="opacity-50 uppercase text-[9px]">Discrepancy</p>
                  <p className={`font-bold flex items-center gap-1 ${Math.abs(selectedLog.discrepancy || 0) > 0.5 ? 'text-orange-600' : ''}`}>
                    {(selectedLog.discrepancy || 0) > 0 ? '+' : ''}{(selectedLog.discrepancy || 0).toFixed(2)} {getConsumptionUnit()}
                    {Math.abs(selectedLog.discrepancy || 0) > 0.5 && <AlertTriangle className="w-3 h-3" />}
                  </p>
                </div>
                <div className="p-2 bg-white/30 border border-[#14141411]">
                  <p className="opacity-50 uppercase text-[9px]">Total Cost</p>
                  <p className="font-bold flex items-center gap-0.5">
                    <span className="font-sans text-[10px] leading-none">{getCurrencySymbol()}</span>
                    {(selectedLog.totalCost || 0).toFixed(2)}
                  </p>
                </div>
                <div className="p-2 bg-white/30 border border-[#14141411]">
                  <p className="opacity-50 uppercase text-[9px]">Price/{getVolumeUnitCode()}</p>
                  <p className="font-bold flex items-center gap-0.5">
                    <span className="font-sans text-[10px] leading-none">{getCurrencySymbol()}</span>
                    {(selectedLog.pricePerLiter || 0).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="mt-6 border-t border-[#14141422] pt-4 flex sm:justify-between gap-2">
            <Button 
              variant="outline" 
              className="border-[#141414] rounded-none font-mono uppercase text-xs flex-1 sm:flex-none"
              onClick={() => selectedLog && handleEditLog(selectedLog)}
            >
              <Edit className="w-4 h-4 mr-2" /> Edit Log
            </Button>
            <Button 
              variant="destructive" 
              className="rounded-none font-mono uppercase text-xs flex-1 sm:flex-none"
              onClick={() => selectedLog && setLogToDelete(selectedLog.id)}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete Log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!logToDelete} onOpenChange={(open) => !open && setLogToDelete(null)}>
        <AlertDialogContent className="bg-[#E4E3E0] border-[#141414] rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono uppercase tracking-widest">Confirm Deletion</AlertDialogTitle>
            <AlertDialogDescription className="font-serif italic">
              Are you sure you want to delete this fuel log? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" size="default" className="border-[#141414] rounded-none font-mono uppercase text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => logToDelete && handleDeleteLog(logToDelete)}
              className="bg-red-600 text-white hover:bg-red-700 rounded-none font-mono uppercase text-xs"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Floating Action Button */}
      <Button 
        onClick={handleStartRefuel}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-[#141414] text-[#E4E3E0] shadow-xl hover:scale-105 transition-transform z-20"
      >
        <Plus className="w-6 h-6" />
      </Button>

      <Dialog open={showAddDialog} onOpenChange={(open) => {
        setShowAddDialog(open);
        if (!open) {
          setRefuelStep('initial');
          setIsEditing(false);
          setEditingLogId(null);
          setIsAnalyzing(false);
          setSelectedTripPhoto(null);
          setSelectedReceipts([]);
          setFormData({
            kmsSinceLastRefill: '',
            totalKms: '',
            ridingMode: 'Road',
            rideType: 'Mixed',
            calculatedConsumption: '',
            actualQuantityFilled: '',
            fuelType: 'Standard',
            timestamp: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
            totalCost: '',
            pricePerLiter: '',
          });
        }
      }}>
        <DialogContent className="sm:max-w-[425px] bg-[#E4E3E0] border-[#141414] rounded-none p-0 overflow-hidden">
          <div className="relative">
            {refuelStep === 'initial' && !isEditing && (
              <div className="p-6 space-y-6">
                <div className="space-y-2 text-center">
                  <Fuel className="w-12 h-12 mx-auto text-[#141414]" />
                  <h2 className="text-xl font-mono uppercase font-bold">New Refill Entry</h2>
                  <p className="text-sm font-serif italic opacity-70">Capture your trip data and receipts for automated logging.</p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <Button 
                    onClick={() => setRefuelStep('photo')}
                    className="w-full bg-[#141414] text-[#E4E3E0] rounded-none font-mono uppercase h-12 flex items-center justify-center gap-2"
                  >
                    Start Guided Entry <ArrowRight className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => setRefuelStep('form')}
                    className="w-full border-[#141414] rounded-none font-mono uppercase h-12"
                  >
                    Manual Entry
                  </Button>
                </div>
              </div>
            )}

            {refuelStep === 'photo' && (
              <div className="p-6 space-y-6">
                <div className="space-y-2 text-center">
                  <Camera className="w-12 h-12 mx-auto text-[#141414]" />
                  <h2 className="text-xl font-mono uppercase font-bold">Step 1: Capture Data</h2>
                  <p className="text-sm font-serif italic opacity-70">Please take a clear photo of your trip computer screen before refueling.</p>
                </div>
                <div className="bg-orange-500/10 border border-orange-500/30 p-4 rounded-none flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                  <p className="text-xs font-mono text-orange-900">REMINDER: Ensure the Trip Kms and Odometer are clearly visible for AI analysis.</p>
                </div>
                <Button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isAnalyzing}
                  className="w-full bg-[#141414] text-[#E4E3E0] rounded-none font-mono uppercase h-12"
                >
                  {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Camera className="w-4 h-4 mr-2" />}
                  {isAnalyzing ? "Analyzing..." : "Take Photo / Upload"}
                </Button>
                <Button variant="ghost" onClick={() => setRefuelStep('receipts')} className="w-full font-mono text-[10px] uppercase opacity-50">Skip to next step</Button>
              </div>
            )}

            {refuelStep === 'receipts' && (
              <div className="p-6 space-y-6">
                <div className="space-y-2 text-center">
                  <Receipt className="w-12 h-12 mx-auto text-[#141414]" />
                  <h2 className="text-xl font-mono uppercase font-bold">Step 2: Fuel Receipts</h2>
                  <p className="text-sm font-serif italic opacity-70">Upload one or more fuel receipts. AI will extract quantity and cost.</p>
                </div>
                
                {selectedReceipts.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {selectedReceipts.map((r, i) => (
                      <div key={i} className="w-16 h-16 shrink-0 border border-[#14141422] relative">
                        <img src={r} alt="receipt" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}

                <Button 
                  onClick={() => receiptInputRef.current?.click()}
                  disabled={isAnalyzing}
                  className="w-full bg-[#141414] text-[#E4E3E0] rounded-none font-mono uppercase h-12"
                >
                  {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  {isAnalyzing ? "Analyzing..." : "Add Receipt(s)"}
                </Button>
                <Button 
                  onClick={() => setRefuelStep('reset')}
                  className="w-full bg-[#141414] text-[#E4E3E0] rounded-none font-mono uppercase h-12 flex items-center justify-center gap-2"
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            )}

            {refuelStep === 'reset' && (
              <div className="p-6 space-y-6">
                <div className="space-y-2 text-center">
                  <RefreshCw className="w-12 h-12 mx-auto text-[#141414]" />
                  <h2 className="text-xl font-mono uppercase font-bold">Step 2: Reset Trip</h2>
                  <p className="text-sm font-serif italic opacity-70">Now that you've captured the data, remember to reset your trip computer on the bike.</p>
                </div>
                <div className="bg-green-500/10 border border-green-500/30 p-4 rounded-none flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  <p className="text-xs font-mono text-green-900">This ensures your next refill log starts from zero for accurate tracking.</p>
                </div>
                <Button 
                  onClick={() => setRefuelStep('form')}
                  className="w-full bg-[#141414] text-[#E4E3E0] rounded-none font-mono uppercase h-12 flex items-center justify-center gap-2"
                >
                  I've Reset the Trip <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            )}

            {refuelStep === 'form' && (
              <div className="p-6">
                <DialogHeader className="mb-4">
                  <div className="flex justify-between items-center">
                    <DialogTitle className="font-mono uppercase tracking-widest">
                      {isEditing ? 'Edit Refill Entry' : 'Step 3: Refill Details'}
                    </DialogTitle>
                    {isEditing && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={() => {
                          setShowAddDialog(false);
                          setIsEditing(false);
                        }}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 text-left">
                      <Label className="font-mono text-[10px] uppercase">Trip {getDistanceUnit()}</Label>
                      <Input 
                        value={formData.kmsSinceLastRefill} 
                        onChange={e => setFormData({...formData, kmsSinceLastRefill: e.target.value})}
                        className="border-[#141414] rounded-none font-mono h-9"
                        placeholder="0.0"
                        required
                      />
                    </div>
                    <div className="space-y-2 text-left">
                      <Label className="font-mono text-[10px] uppercase">Odometer ({getDistanceUnit()})</Label>
                      <Input 
                        value={formData.totalKms} 
                        onChange={e => setFormData({...formData, totalKms: e.target.value})}
                        className="border-[#141414] rounded-none font-mono h-9"
                        placeholder="0"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 text-left">
                      <Label className="font-mono text-[10px] uppercase">Riding Mode</Label>
                      <Select value={formData.ridingMode} onValueChange={v => setFormData({...formData, ridingMode: v})}>
                        <SelectTrigger className="border-[#141414] rounded-none font-mono h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[#E4E3E0] border-[#141414] rounded-none">
                          {RIDING_MODES.map(m => (
                            <SelectItem key={m} value={m} className="font-mono">{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 text-left">
                      <Label className="font-mono text-[10px] uppercase">Disp. Calc ({getConsumptionUnit()})</Label>
                      <Input 
                        value={formData.calculatedConsumption} 
                        onChange={e => setFormData({...formData, calculatedConsumption: e.target.value})}
                        className="border-[#141414] rounded-none font-mono h-9"
                        placeholder="0.0"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 text-left">
                      <Label className="font-mono text-[10px] uppercase">{getVolumeUnitLabel()} Filled</Label>
                      <Input 
                        value={formData.actualQuantityFilled} 
                        onChange={e => setFormData({...formData, actualQuantityFilled: e.target.value})}
                        className="border-[#141414] rounded-none font-mono h-9"
                        placeholder="0.0"
                        required
                      />
                    </div>
                    <div className="space-y-2 text-left">
                      <Label className="font-mono text-[10px] uppercase">Fuel Grade</Label>
                      <Select value={formData.fuelType} onValueChange={(v: any) => setFormData({...formData, fuelType: v})}>
                        <SelectTrigger className="border-[#141414] rounded-none font-mono h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[#E4E3E0] border-[#141414] rounded-none">
                          <SelectItem value="Standard" className="font-mono">Standard</SelectItem>
                          <SelectItem value="Premium" className="font-mono">Premium</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 text-left">
                      <Label className="font-mono text-[10px] uppercase">Total Cost ({getCurrencySymbol()})</Label>
                      <Input 
                        value={formData.totalCost} 
                        onChange={e => setFormData({...formData, totalCost: e.target.value})}
                        className="border-[#141414] rounded-none font-mono h-9"
                        placeholder="0.00"
                        required
                      />
                    </div>
                    <div className="space-y-2 text-left">
                      <Label className="font-mono text-[10px] uppercase">Price / {getVolumeUnitCode()} ({getCurrencySymbol()})</Label>
                      <Input 
                        value={formData.pricePerLiter} 
                        onChange={e => setFormData({...formData, pricePerLiter: e.target.value})}
                        className="border-[#141414] rounded-none font-mono h-9"
                        placeholder="0.00"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase">Ride Type</Label>
                    <Select value={formData.rideType} onValueChange={(v: any) => setFormData({...formData, rideType: v})}>
                      <SelectTrigger className="border-[#141414] rounded-none font-mono h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#E4E3E0] border-[#141414] rounded-none">
                        <SelectItem value="City" className="font-mono">City</SelectItem>
                        <SelectItem value="Highway" className="font-mono">Highway</SelectItem>
                        <SelectItem value="Mixed" className="font-mono">Mixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase">Date & Time</Label>
                    <Input 
                      type="datetime-local"
                      value={formData.timestamp} 
                      onChange={e => setFormData({...formData, timestamp: e.target.value})}
                      className="border-[#141414] rounded-none font-mono h-9"
                      required
                    />
                  </div>

                  {isEditing && (
                    <div className="space-y-4 pt-2 border-t border-[#14141422]">
                      <h3 className="font-mono text-[10px] uppercase font-bold">Add/Update Photos</h3>
                      <div className="grid grid-cols-2 gap-2">
                        <Button 
                          type="button"
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                          className="border-[#141414] rounded-none font-mono text-[10px] uppercase h-10"
                        >
                          <Camera className="w-3 h-3 mr-2" /> Trip Photo
                        </Button>
                        <Button 
                          type="button"
                          variant="outline"
                          onClick={() => receiptInputRef.current?.click()}
                          className="border-[#141414] rounded-none font-mono text-[10px] uppercase h-10"
                        >
                          <Receipt className="w-3 h-3 mr-2" /> Receipts
                        </Button>
                      </div>
                      {(selectedTripPhoto || selectedReceipts.length > 0) && (
                        <p className="text-[10px] font-mono text-blue-600 animate-pulse">
                          New photos ready for upload
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex gap-3 mt-4">
                    <Button 
                      type="button"
                      variant="outline"
                      onClick={() => setShowAddDialog(false)}
                      className="flex-1 border-[#141414] rounded-none font-mono uppercase h-12"
                    >
                      Cancel
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={isAnalyzing}
                      className="flex-[2] bg-[#141414] text-[#E4E3E0] rounded-none font-mono uppercase h-12"
                    >
                      {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                      {isAnalyzing ? "Saving..." : (isEditing ? "Save Changes" : "Complete Refill Entry")}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* Hidden inputs moved here to be accessible in all steps including 'form' (edit mode) */}
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/jpeg,image/png,image/heic,image/*"
            onChange={async (e) => {
              await handlePhotoUpload(e);
            }}
          />
          <input 
            type="file" 
            ref={receiptInputRef} 
            className="hidden" 
            accept="image/jpeg,image/png,image/heic,image/*" 
            multiple
            onChange={handleReceiptUpload}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDiscrepancyDialog} onOpenChange={setShowDiscrepancyDialog}>
        <AlertDialogContent className="bg-[#E4E3E0] border-2 border-[#141414] rounded-none p-6 max-w-md">
          <AlertDialogHeader className="space-y-3">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-6 h-6 shrink-0 text-red-600" />
              <AlertDialogTitle className="font-mono text-lg uppercase font-bold text-red-700">
                Odometer Discrepancy Detected
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm font-serif text-[#141414] leading-relaxed">
              We detected a significant difference between your entered trip distance and the distance calculated from your odometer reading difference.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {discrepancyData && (
            <div className="my-5 p-4 border border-[#141414] bg-[#f0efe9] space-y-3 font-mono text-xs text-[#141414]">
              <div className="flex justify-between border-b border-[#14141422] pb-1.5">
                <span className="opacity-70">Present Odometer:</span>
                <span className="font-bold">{discrepancyData.presentOdometer} km</span>
              </div>
              <div className="flex justify-between border-b border-[#14141422] pb-1.5">
                <span className="opacity-70">Previous Odometer:</span>
                <span className="font-bold">{discrepancyData.previousOdometer} km</span>
              </div>
              <div className="flex justify-between border-b border-[#14141422] pb-1.5 bg-amber-500/10 px-1 py-0.5">
                <span className="font-semibold text-amber-950">Calculated Trip Distance:</span>
                <span className="font-bold text-amber-950">{discrepancyData.calculatedKms} km</span>
              </div>
              <div className="flex justify-between border-b border-[#14141422] pb-1.5 bg-blue-500/10 px-1 py-0.5">
                <span className="font-semibold text-blue-950">Entered Trip Distance:</span>
                <span className="font-bold text-blue-950">{discrepancyData.enteredKms} km</span>
              </div>
              <div className="text-[11px] leading-tight font-sans italic text-[#141414]/70 pt-1">
                The difference is <strong className="text-red-700 font-mono">{Math.abs(discrepancyData.calculatedKms - discrepancyData.enteredKms).toFixed(1)} km</strong>. Which value is correct?
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 mt-4">
            <Button
              type="button"
              onClick={async () => {
                if (discrepancyData) {
                  setFormData(prev => ({ ...prev, kmsSinceLastRefill: discrepancyData.calculatedKms.toString() }));
                  setShowDiscrepancyDialog(false);
                  await executeSave(discrepancyData.calculatedKms, discrepancyData.presentOdometer);
                }
              }}
              className="w-full bg-[#141414] hover:bg-[#222222] text-[#E4E3E0] rounded-none font-mono text-xs uppercase h-11 flex justify-between px-4 items-center"
            >
              <span>Use Calculated Distance</span>
              <span className="bg-[#E4E3E0] text-[#141414] px-2 py-0.5 font-bold font-mono text-[10px]">
                {discrepancyData?.calculatedKms} km
              </span>
            </Button>

            <Button
              type="button"
              onClick={async () => {
                if (discrepancyData) {
                  setShowDiscrepancyDialog(false);
                  await executeSave(discrepancyData.enteredKms, discrepancyData.presentOdometer);
                }
              }}
              className="w-full border-2 border-[#141414] hover:bg-[#141414]/5 bg-transparent text-[#141414] rounded-none font-mono text-xs uppercase h-11 flex justify-between px-4 items-center"
            >
              <span>Keep Entered Distance</span>
              <span className="bg-[#141414] text-[#E4E3E0] px-2 py-0.5 font-bold font-mono text-[10px]">
                {discrepancyData?.enteredKms} km
              </span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowDiscrepancyDialog(false);
              }}
              className="w-full hover:bg-[#141414]/5 text-[#141414]/70 hover:text-[#141414] rounded-none font-mono text-[11px] uppercase h-10 mt-1"
            >
              Correct Manually / Go Back
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showEditVehicleDialog} onOpenChange={setShowEditVehicleDialog}>
        <DialogContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none max-w-sm overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-widest text-center border-b border-[#141414] pb-5 text-sm font-bold">Preferences & Vehicle Setup</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Section 1: Vehicle Details */}
            <div className="space-y-4">
              <h3 className="text-[10px] uppercase font-bold tracking-widest opacity-60 border-b border-[#141414]/10 pb-1 text-left">Vehicle Details</h3>
              <div className="space-y-2 text-left">
                <Label className="text-[10px] uppercase opacity-50">Nickname</Label>
                <Input 
                  placeholder="e.g. My GS, Daily Car"
                  value={editVehicleData.nickname}
                  onChange={e => setEditVehicleData(prev => ({ ...prev, nickname: e.target.value }))}
                  className="border-[#141414] rounded-none bg-transparent h-9"
                  required
                />
              </div>
              <div className="space-y-2 text-left">
                <Label className="text-[10px] uppercase opacity-50">Vehicle Type</Label>
                <Select 
                  value={editVehicleData.type}
                  onValueChange={(val: any) => setEditVehicleData(prev => ({ ...prev, type: val }))}
                >
                  <SelectTrigger className="border-[#141414] rounded-none bg-transparent h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none">
                    <SelectItem value="2 Wheeler">2 Wheeler</SelectItem>
                    <SelectItem value="4 Wheeler">4 Wheeler</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 text-left">
                <Label className="text-[10px] uppercase opacity-50">Registration Number</Label>
                <Input 
                  placeholder="e.g. KA-01-AB-1234"
                  value={editVehicleData.registration}
                  onChange={e => setEditVehicleData(prev => ({ ...prev, registration: e.target.value }))}
                  className="border-[#141414] rounded-none bg-transparent h-9"
                />
              </div>
            </div>

            {/* Section 2: Regional Preferences */}
            <div className="space-y-4 border-t border-[#141414]/10 pt-4">
              <h3 className="text-[10px] uppercase font-bold tracking-widest opacity-60 border-b border-[#141414]/10 pb-1 text-left">Regional Settings</h3>
              
              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="space-y-1">
                  <Label className="text-[9px] font-mono uppercase opacity-50 block">Distance Unit</Label>
                  <Select 
                    value={editDistanceUnit} 
                    onValueChange={(val: any) => setEditDistanceUnit(val)}
                  >
                    <SelectTrigger className="border-[#141414] rounded-none bg-transparent h-8 font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none">
                      <SelectItem value="km">Kilometer (km)</SelectItem>
                      <SelectItem value="mi">Mile (mi)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1 text-left">
                  <Label className="text-[9px] font-mono uppercase opacity-50 block">Volume Unit</Label>
                  <Select 
                    value={editVolumeUnit} 
                    onValueChange={(val: any) => setEditVolumeUnit(val)}
                  >
                    <SelectTrigger className="border-[#141414] rounded-none bg-transparent h-8 font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none">
                      <SelectItem value="L">Liters (L)</SelectItem>
                      <SelectItem value="gal_us">Gallons (US)</SelectItem>
                      <SelectItem value="gal_uk">Gallons (UK)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="space-y-1">
                  <Label className="text-[9px] font-mono uppercase opacity-50 block">Currency Symbol</Label>
                  <Input
                    value={editCurrency}
                    onChange={e => setEditCurrency(e.target.value)}
                    placeholder="e.g. $, ₹, €"
                    className="border-[#141414] rounded-none bg-transparent h-8 font-mono text-xs"
                    maxLength={5}
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[9px] font-mono uppercase opacity-50 block">Fuel Economy</Label>
                  <Select 
                    value={editConsumptionUnit} 
                    onValueChange={(val: any) => setEditConsumptionUnit(val)}
                  >
                    <SelectTrigger className="border-[#141414] rounded-none bg-transparent h-8 font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none">
                      <SelectItem value="km/L">km/L</SelectItem>
                      <SelectItem value="L/100km">L/100km</SelectItem>
                      <SelectItem value="MPG (US)">MPG (US)</SelectItem>
                      <SelectItem value="MPG (UK)">MPG (UK)</SelectItem>
                      <SelectItem value="mi/L">mi/L</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleUpdateSettings} className="w-full bg-[#141414] text-[#E4E3E0] rounded-none hover:bg-[#2a2a2a] h-12 uppercase tracking-wide text-xs">
              Save Preferences & Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feedback Submission Dialog (Overlay Mode) */}
      <Dialog open={showFeedbackDialog} onOpenChange={setShowFeedbackDialog}>
        <DialogContent className="sm:max-w-[450px] bg-[#E4E3E0] border-[#141414] rounded-none p-6">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest border-b border-[#14141422] pb-2 text-left">Submit Feedback</DialogTitle>
            <DialogDescription className="font-serif italic text-xs mt-1 text-left">We read and act on all suggestions!</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitFeedback} className="space-y-4 mt-4 text-left">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-mono tracking-widest block font-bold text-left">Feedback Category</label>
              <select
                value={feedbackCategory}
                onChange={(e: any) => setFeedbackCategory(e.target.value)}
                className="w-full bg-[#E4E3E0] border border-[#141414] p-2 text-xs font-mono rounded-none"
              >
                <option value="Suggestion">Suggestion</option>
                <option value="Bug">Bug Report</option>
                <option value="Feature Request">Feature Request</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="space-y-1.5 text-left">
              <label className="text-[10px] uppercase font-mono tracking-widest block font-bold text-left">Your Feedback, Request, or Bug Details</label>
              <textarea
                placeholder="Write your feedback here..."
                rows={5}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                className="w-full bg-white/50 border border-[#141414] p-2 text-xs font-mono rounded-none resize-none"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#14141411]">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowFeedbackDialog(false)}
                className="rounded-none border-[#141414] font-mono text-xs uppercase cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isFeedbackSubmitting}
                className="rounded-none bg-[#141414] text-[#E4E3E0] hover:bg-[#141414dd] font-mono text-xs uppercase cursor-pointer"
              >
                {isFeedbackSubmitting ? "Sending..." : "Submit Feedback"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Toaster position="top-center" />
    </div>
  );
}
