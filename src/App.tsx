import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
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
  IndianRupee,
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
  X
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [dashboardLogs, setDashboardLogs] = useState<FuelLog[]>([]);
  const [historyLogs, setHistoryLogs] = useState<FuelLog[]>([]);
  const [orphanedLogsCount, setOrphanedLogsCount] = useState(0);

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

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
        // Auto-create a default vehicle if none exists
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
    }, (error) => {
      console.error("Error fetching vehicles:", error);
    });

    return unsubscribe;
  }, [user]);

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
      const logDate = new Date(log.timestamp);
      if (isNaN(logDate.getTime())) return false;
      
      const start = new Date(dateRange.start);
      const end = new Date(dateRange.end);
      
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
        hLogs = hLogs.filter(log => log.timestamp && new Date(log.timestamp) >= subDays(now, 7));
      } else if (filterDateRange === '30d') {
        hLogs = hLogs.filter(log => log.timestamp && new Date(log.timestamp) >= subDays(now, 30));
      } else if (filterDateRange === '90d') {
        hLogs = hLogs.filter(log => log.timestamp && new Date(log.timestamp) >= subDays(now, 90));
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
      "Trip Kms", 
      "Total Kms", 
      "Riding Mode", 
      "Ride Type",
      "Fuel Type", 
      "Liters Filled", 
      "Actual Consumption (km/L)", 
      "Calculated Consumption (km/L)", 
      "Discrepancy", 
      "Total Cost", 
      "Price Per Liter"
    ];

    const rows = historyLogs.map(log => [
      format(new Date(log.timestamp), "dd/MM/yyyy HH:mm"),
      log.kmsSinceLastRefill,
      log.totalKms,
      log.ridingMode,
      log.rideType || 'Mixed',
      log.fuelType,
      log.actualQuantityFilled,
      log.actualConsumption.toFixed(2),
      log.calculatedConsumption.toFixed(2),
      log.discrepancy.toFixed(2),
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

  const handleUpdateVehicle = async () => {
    if (!selectedVehicle || !user) return;
    if (!editVehicleData.nickname || !editVehicleData.registration) {
      toast.error("Please fill all fields");
      return;
    }

    try {
      await updateDoc(doc(db, 'vehicles', selectedVehicle.id), {
        nickname: editVehicleData.nickname,
        registration: editVehicleData.registration,
        type: editVehicleData.type
      });
      toast.success("Vehicle updated!");
      setShowEditVehicleDialog(false);
    } catch (error) {
      console.error("Error updating vehicle:", error);
      toast.error("Failed to update vehicle");
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

    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64 = reader.result as string;
        setSelectedTripPhoto(base64);
        const data = await analyzeTripPhoto(base64);
        
        if (data) {
          setFormData(prev => {
            let newTimestamp = prev.timestamp;
            if (data.time) {
              const today = format(new Date(), "yyyy-MM-dd");
              newTimestamp = `${today}T${data.time}`;
            }

            return {
              ...prev,
              kmsSinceLastRefill: data.kmsSinceLastRefill.toString(),
              totalKms: data.totalKms.toString(),
              ridingMode: data.ridingMode || prev.ridingMode,
              calculatedConsumption: data.calculatedConsumption.toString(),
              timestamp: newTimestamp,
            };
          });
          toast.success("Trip data extracted!");
          if (!isEditing) setRefuelStep('receipts');
        } else {
          toast.error("Could not read trip data.");
          if (!isEditing) setRefuelStep('receipts');
        }
      } catch (error) {
        console.error("Photo analysis error:", error);
        toast.error("An error occurred during photo analysis.");
      } finally {
        setIsAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsAnalyzing(true);
    toast.info("Analyzing receipts...");

    const base64Promises = files.map((file: File) => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    });

    const base64s = await Promise.all(base64Promises);
    setSelectedReceipts(prev => [...prev, ...base64s]);

    try {
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
    } catch (error) {
      console.error("Receipt analysis error:", error);
      toast.error("An error occurred during receipt analysis.");
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
    const liters = parseFloat(formData.actualQuantityFilled);
    const calcCons = parseFloat(formData.calculatedConsumption) || 0;

    if (isNaN(kms) || isNaN(liters) || kms <= 0) {
      toast.error("Please enter valid numbers for kms (greater than 0) and liters.");
      return;
    }

    const actualConsumption = kms / liters;
    const discrepancy = isNaN(calcCons) ? 0 : calcCons - actualConsumption;

    if (!db) {
      toast.error("Firebase services not initialized.");
      return;
    }

    setIsAnalyzing(true);
    toast.info("Saving log...");
    console.log("Starting handleSubmit (without photo upload)...");

    try {
      const payload: any = {
        userId: user.uid,
        vehicleId: selectedVehicle?.id,
        timestamp: formData.timestamp,
        kmsSinceLastRefill: kms,
        totalKms: parseFloat(formData.totalKms) || 0,
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
          <Button onClick={handleLogin} className="w-full bg-[#141414] text-[#E4E3E0] hover:bg-[#2a2a2a] h-12 text-lg font-mono">
            SIGN IN WITH GOOGLE
          </Button>
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

  const chartData = [...dashboardLogs].reverse().map(log => ({
    date: format(new Date(log.timestamp), 'MMM dd'),
    actual: parseFloat((log.actualConsumption || 0).toFixed(2)),
    calculated: parseFloat((log.calculatedConsumption || 0).toFixed(2)),
    mode: log.ridingMode,
    fuel: log.fuelType,
    discrepancy: Math.abs(log.discrepancy || 0)
  }));

  const stats = {
    avgConsumption: dashboardLogs.length > 0 
      ? (dashboardLogs.reduce((acc, log) => acc + log.actualConsumption, 0) / dashboardLogs.length).toFixed(2)
      : '0.00',
    totalLiters: dashboardLogs.reduce((acc, log) => acc + log.actualQuantityFilled, 0).toFixed(1),
    totalKms: dashboardLogs.reduce((acc, log) => acc + log.kmsSinceLastRefill, 0).toFixed(0),
    maxDiscrepancy: dashboardLogs.length > 0
      ? Math.max(...dashboardLogs.map(l => Math.abs(l.discrepancy || 0))).toFixed(2)
      : '0.00',
    totalCost: dashboardLogs.reduce((acc, log) => acc + (log.totalCost || 0), 0).toFixed(2),
    avgCostPerKm: dashboardLogs.length > 0
      ? (dashboardLogs.reduce((acc, log) => acc + (log.totalCost || 0), 0) / dashboardLogs.reduce((acc, log) => acc + log.kmsSinceLastRefill, 0)).toFixed(2)
      : '0.00',
    ecoEfficiency: (() => {
      const ecoLogs = dashboardLogs.filter(l => l.ridingMode?.toLowerCase() === 'eco');
      if (ecoLogs.length === 0) return '0.00';
      return (ecoLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / ecoLogs.length).toFixed(2);
    })(),
    ecoSavings: (() => {
      const ecoLogs = dashboardLogs.filter(l => l.ridingMode?.toLowerCase() === 'eco');
      const nonEcoLogs = dashboardLogs.filter(l => l.ridingMode?.toLowerCase() !== 'eco' && l.ridingMode);
      if (ecoLogs.length === 0 || nonEcoLogs.length === 0) return '0.00';
      
      const ecoAvg = ecoLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / ecoLogs.length;
      const nonEcoAvg = nonEcoLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / nonEcoLogs.length;
      
      return (ecoAvg - nonEcoAvg).toFixed(2);
    })()
  };

  const modeEfficiencyData = RIDING_MODES.map(mode => {
    const modeLogs = dashboardLogs.filter(l => l.ridingMode?.toLowerCase() === mode.toLowerCase());
    const avg = modeLogs.length > 0 ? modeLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / modeLogs.length : 0;
    return { mode, actual: parseFloat(avg.toFixed(2)) };
  }).filter(d => d.actual > 0);

  const fuelEfficiencyData = ['Standard', 'Premium'].map(fuel => {
    const fuelLogs = dashboardLogs.filter(l => l.fuelType?.toLowerCase() === fuel.toLowerCase());
    const avg = fuelLogs.length > 0 ? fuelLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / fuelLogs.length : 0;
    return { fuel, actual: parseFloat(avg.toFixed(2)) };
  }).filter(d => d.actual > 0);

  const rideTypeEfficiencyData = ['City', 'Highway', 'Mixed'].map(type => {
    const typeLogs = dashboardLogs.filter(l => (l.rideType || 'Mixed').toLowerCase() === type.toLowerCase());
    const avg = typeLogs.length > 0 ? typeLogs.reduce((acc, l) => acc + (l.actualConsumption || 0), 0) / typeLogs.length : 0;
    return { type, actual: parseFloat(avg.toFixed(2)) };
  }).filter(d => d.actual > 0);

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
      <header className="border-b border-[#141414] p-4 flex justify-between items-center bg-[#E4E3E0] sticky top-0 z-10">
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
            onClick={() => {
              if (selectedVehicle) {
                setEditVehicleData({
                  nickname: selectedVehicle.nickname,
                  registration: selectedVehicle.registration,
                  type: selectedVehicle.type
                });
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
      </header>

      <main className="max-w-5xl mx-auto p-4 space-y-6">
        {/* Reminders */}
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
                <p className="text-2xl font-bold font-mono">{stats.avgConsumption} <span className="text-xs">km/L</span></p>
              </div>
              <div>
                <p className="text-[10px] uppercase opacity-50 font-mono">ECO Efficiency</p>
                <p className="text-2xl font-bold font-mono text-green-600">{stats.ecoEfficiency} <span className="text-xs">km/L</span></p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-transparent border border-[#141414] p-1 rounded-none h-auto">
            <TabsTrigger value="dashboard" className="rounded-none data-[state=active]:bg-[#141414] data-[state=active]:text-[#E4E3E0] font-mono uppercase text-[10px] py-2">Dashboard</TabsTrigger>
            <TabsTrigger value="report" className="rounded-none data-[state=active]:bg-[#141414] data-[state=active]:text-[#E4E3E0] font-mono uppercase text-[10px] py-2">Report</TabsTrigger>
            <TabsTrigger value="history" className="rounded-none data-[state=active]:bg-[#141414] data-[state=active]:text-[#E4E3E0] font-mono uppercase text-[10px] py-2">History</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6 mt-6">
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
                <CardDescription className="font-serif italic">Actual vs Calculated Fuel Economy (km/L)</CardDescription>
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
                  <CardDescription className="text-[10px] font-mono opacity-50">Average km/L per Riding Mode</CardDescription>
                </CardHeader>
                <CardContent className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={modeEfficiencyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#14141422" vertical={false} />
                      <XAxis dataKey="mode" stroke="#141414" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#141414" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{fill: '#14141411'}} contentStyle={{ backgroundColor: '#141414', border: 'none', color: '#E4E3E0', fontFamily: 'monospace' }} />
                      <Bar dataKey="actual" fill="#141414" radius={[4, 4, 0, 0]} name="Avg km/L" />
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
                      <Bar dataKey="actual" fill="#2563eb" radius={[4, 4, 0, 0]} name="Avg km/L" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-[#141414] bg-white/50">
                <CardHeader>
                  <CardTitle className="text-lg font-mono uppercase">Ride Type Efficiency</CardTitle>
                  <CardDescription className="text-[10px] font-mono opacity-50">City vs Highway vs Mixed</CardDescription>
                </CardHeader>
                <CardContent className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rideTypeEfficiencyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#14141422" vertical={false} />
                      <XAxis dataKey="type" stroke="#141414" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#141414" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{fill: '#14141411'}} contentStyle={{ backgroundColor: '#141414', border: 'none', color: '#E4E3E0', fontFamily: 'monospace' }} />
                      <Bar dataKey="actual" fill="#16a34a" radius={[4, 4, 0, 0]} name="Avg km/L" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

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
                          <TableCell className="font-mono text-[10px]">{totalKms.toFixed(0)} km</TableCell>
                          <TableCell className="font-mono text-[10px]">₹{costPerKm.toFixed(2)}</TableCell>
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
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">AVG KM/L</TableHead>
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">TOTAL KMS</TableHead>
                      <TableHead className="text-[#E4E3E0] font-mono text-[10px]">FUEL COST / KM</TableHead>
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
                          <TableCell className="font-mono text-[10px]">{totalKms.toFixed(0)} km</TableCell>
                          <TableCell className="font-mono text-[10px]">₹{costPerKm.toFixed(2)}</TableCell>
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

          <TabsContent value="report" className="mt-6 space-y-6">
            <Card className="border-[#141414] bg-[#141414] text-[#E4E3E0] rounded-none">
              <CardHeader>
                <CardTitle className="font-mono uppercase tracking-widest flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Efficiency Summary Report
                </CardTitle>
                <CardDescription className="text-[#E4E3E0] opacity-60 font-mono text-xs">
                  {format(new Date(dateRange.start), 'dd/MM/yyyy')} to {format(new Date(dateRange.end), 'dd/MM/yyyy')}
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
                  
                  const improvement = nonEcoAvg > 0 ? ((ecoAvg - nonEcoAvg) / nonEcoAvg) * 100 : 0;
                  const totalEcoKms = ecoLogs.reduce((acc, l) => acc + (l.kmsSinceLastRefill || 0), 0);
                  const estimatedLitersSaved = nonEcoAvg > 0 ? (totalEcoKms / nonEcoAvg) - (totalEcoKms / ecoAvg) : 0;
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
                        <p className="text-2xl font-bold font-mono text-green-700">{estimatedLitersSaved.toFixed(2)} L</p>
                        <p className="text-[10px] font-serif italic mt-1">estimated total savings</p>
                      </div>
                      <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-none">
                        <p className="text-[10px] uppercase opacity-50 font-mono">Money Saved</p>
                        <p className="text-2xl font-bold font-mono text-green-700">₹{estimatedMoneySaved.toFixed(2)}</p>
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
                      <p className="text-xl font-bold font-mono">₹{stats.totalCost}</p>
                    </div>
                    <div className="p-3 bg-[#141414] text-[#E4E3E0] rounded-none">
                      <p className="text-[10px] uppercase opacity-50 font-mono">Avg Cost / Km</p>
                      <p className="text-xl font-bold font-mono">₹{stats.avgCostPerKm}</p>
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
                              <p className="text-xs font-bold font-mono">₹{totalFuelCost.toFixed(2)}</p>
                            </div>
                            <div className="p-2 bg-white/40 border border-[#14141411]">
                              <p className="text-[8px] uppercase opacity-50 font-mono">Distance</p>
                              <p className="text-xs font-bold font-mono">{totalFuelKms.toFixed(0)} km</p>
                            </div>
                            <div className="p-2 bg-blue-600 text-white border border-[#14141411]">
                              <p className="text-[8px] uppercase opacity-70 font-mono">Avg Cost/Km</p>
                              <p className="text-xs font-bold font-mono">₹{avgCostPerKm}</p>
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
                                <span className="text-xs font-mono font-bold">₹{modeAvgCost} / km</span>
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
                          <TableCell className="font-mono text-xs font-bold">₹{costPerKm.toFixed(2)}</TableCell>
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
                          <p className="text-xs font-bold">{format(new Date(log.timestamp), 'dd/MM/yyyy')}</p>
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

          <TabsContent value="history" className="mt-6">
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
                      <TableCell className="font-mono text-xs">{format(new Date(log.timestamp), 'dd/MM/yyyy')}</TableCell>
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
        </Tabs>
      </main>

      {/* Log Details Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="sm:max-w-[500px] bg-[#E4E3E0] border-[#141414] rounded-none p-6 overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest border-b border-[#14141422] pb-2">Log Details: {selectedLog && format(new Date(selectedLog.timestamp), 'dd/MM/yyyy HH:mm')}</DialogTitle>
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
                    {(selectedLog.discrepancy || 0) > 0 ? '+' : ''}{(selectedLog.discrepancy || 0).toFixed(2)} km/L
                    {Math.abs(selectedLog.discrepancy || 0) > 0.5 && <AlertTriangle className="w-3 h-3" />}
                  </p>
                </div>
                <div className="p-2 bg-white/30 border border-[#14141411]">
                  <p className="opacity-50 uppercase text-[9px]">Total Cost</p>
                  <p className="font-bold">₹{(selectedLog.totalCost || 0).toFixed(2)}</p>
                </div>
                <div className="p-2 bg-white/30 border border-[#14141411]">
                  <p className="opacity-50 uppercase text-[9px]">Price/Liter</p>
                  <p className="font-bold">₹{(selectedLog.pricePerLiter || 0).toFixed(2)}</p>
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
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase">Trip Kms</Label>
                      <Input 
                        value={formData.kmsSinceLastRefill} 
                        onChange={e => setFormData({...formData, kmsSinceLastRefill: e.target.value})}
                        className="border-[#141414] rounded-none font-mono h-9"
                        placeholder="0.0"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase">Odometer</Label>
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
                    <div className="space-y-2">
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
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase">Bike Calc (km/L)</Label>
                      <Input 
                        value={formData.calculatedConsumption} 
                        onChange={e => setFormData({...formData, calculatedConsumption: e.target.value})}
                        className="border-[#141414] rounded-none font-mono h-9"
                        placeholder="0.0"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase">Liters Filled</Label>
                      <Input 
                        value={formData.actualQuantityFilled} 
                        onChange={e => setFormData({...formData, actualQuantityFilled: e.target.value})}
                        className="border-[#141414] rounded-none font-mono h-9"
                        placeholder="0.0"
                        required
                      />
                    </div>
                    <div className="space-y-2">
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
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase">Total Cost (₹)</Label>
                      <Input 
                        value={formData.totalCost} 
                        onChange={e => setFormData({...formData, totalCost: e.target.value})}
                        className="border-[#141414] rounded-none font-mono h-9"
                        placeholder="0.00"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase">Price / Liter (₹)</Label>
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
            accept="image/*" 
            onChange={async (e) => {
              await handlePhotoUpload(e);
            }}
          />
          <input 
            type="file" 
            ref={receiptInputRef} 
            className="hidden" 
            accept="image/*" 
            multiple
            onChange={handleReceiptUpload}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showEditVehicleDialog} onOpenChange={setShowEditVehicleDialog}>
        <DialogContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none max-w-sm">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-widest text-center border-b border-[#141414] pb-4">Edit Vehicle Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-2">
              <Label className="text-[10px] uppercase opacity-50">Nickname</Label>
              <Input 
                placeholder="e.g. My GS, Daily Car"
                value={editVehicleData.nickname}
                onChange={e => setEditVehicleData(prev => ({ ...prev, nickname: e.target.value }))}
                className="border-[#141414] rounded-none bg-transparent"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase opacity-50">Vehicle Type</Label>
              <Select 
                value={editVehicleData.type}
                onValueChange={(val: any) => setEditVehicleData(prev => ({ ...prev, type: val }))}
              >
                <SelectTrigger className="border-[#141414] rounded-none bg-transparent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#E4E3E0] border-[#141414] font-mono rounded-none">
                  <SelectItem value="2 Wheeler">2 Wheeler</SelectItem>
                  <SelectItem value="4 Wheeler">4 Wheeler</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase opacity-50">Registration Number</Label>
              <Input 
                placeholder="e.g. KA-01-AB-1234"
                value={editVehicleData.registration}
                onChange={e => setEditVehicleData(prev => ({ ...prev, registration: e.target.value }))}
                className="border-[#141414] rounded-none bg-transparent"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleUpdateVehicle} className="w-full bg-[#141414] text-[#E4E3E0] rounded-none hover:bg-[#2a2a2a] h-12">
              UPDATE_VEHICLE_DATA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster position="top-center" />
    </div>
  );
}
