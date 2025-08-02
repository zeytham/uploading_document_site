// Global variables
let currentUser = null;
let currentPage = 'dashboard';
let authMode = 'login'; // 'login' or 'register'
let currentFiles = [];
let currentFileId = null;

// API Base URL
const API_BASE = '/api';

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

// Initialize application
async function initializeApp() {
    showLoading(true);
    
    try {
        // Check if user is already authenticated
        const token = localStorage.getItem('token');
        if (token) {
            const isValid = await verifyToken();
            if (isValid) {
                await loadUserProfile();
                showMainApp();
                loadDashboard();
            } else {
                showAuthPage();
            }
        } else {
            showAuthPage();
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showAuthPage();
    } finally {
        showLoading(false);
    }
    
    setupEventListeners();
}

// Setup event listeners
function setupEventListeners() {
    // Auth form
    document.getElementById('authForm').addEventListener('submit', handleAuth);
    document.getElementById('authToggle').addEventListener('click', toggleAuthMode);
    
    // Navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = e.target.getAttribute('data-page');
            navigateToPage(page);
        });
    });
    
    // User menu
    document.getElementById('userAvatar').addEventListener('click', toggleUserMenu);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // Profile dropdown links
    document.querySelectorAll('.dropdown-item[data-page]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = e.target.getAttribute('data-page');
            toggleUserMenu();
            navigateToPage(page);
        });
    });
    
    // File upload
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    
    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('drop', handleFileDrop);
    fileInput.addEventListener('change', handleFileSelect);
    
    // File search and filters
    document.getElementById('searchFiles').addEventListener('input', debounce(searchFiles, 300));
    document.getElementById('categoryFilter').addEventListener('change', filterFiles);
    document.getElementById('sortBy').addEventListener('change', sortFiles);
    
    // Profile form
    document.getElementById('profileForm').addEventListener('submit', updateProfile);
    
    // File edit modal
    document.getElementById('saveFileEdit').addEventListener('click', saveFileEdit);
    
    // Close modals when clicking outside
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });
    
    // Close user menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.user-menu')) {
            document.getElementById('userDropdown').classList.remove('show');
        }
    });
}

// Authentication functions
async function handleAuth(e) {
    e.preventDefault();
    showLoading(true);
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const fullName = document.getElementById('fullName').value;
    const subject = document.getElementById('subject').value;
    const school = document.getElementById('school').value;
    
    try {
        let response;
        if (authMode === 'login') {
            response = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
        } else {
            response = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, fullName, subject, school })
            });
        }
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('token', data.token);
            currentUser = data.user;
            showAlert('authAlert', 'success', `${authMode === 'login' ? 'Login' : 'Registration'} successful!`);
            setTimeout(() => {
                showMainApp();
                loadDashboard();
            }, 1000);
        } else {
            showAlert('authAlert', 'error', data.message || data.error);
        }
    } catch (error) {
        console.error('Auth error:', error);
        showAlert('authAlert', 'error', 'An error occurred. Please try again.');
    } finally {
        showLoading(false);
    }
}

function toggleAuthMode(e) {
    e.preventDefault();
    authMode = authMode === 'login' ? 'register' : 'login';
    
    const title = document.getElementById('authTitle');
    const submitBtn = document.getElementById('authSubmit');
    const toggle = document.getElementById('authToggle');
    const fullNameGroup = document.getElementById('fullNameGroup');
    const subjectGroup = document.getElementById('subjectGroup');
    const schoolGroup = document.getElementById('schoolGroup');
    
    if (authMode === 'register') {
        title.textContent = 'Create Account';
        submitBtn.innerHTML = '<i class="fas fa-user-plus"></i> Sign Up';
        toggle.textContent = 'Already have an account? Sign in';
        fullNameGroup.style.display = 'block';
        subjectGroup.style.display = 'block';
        schoolGroup.style.display = 'block';
        document.getElementById('fullName').required = true;
    } else {
        title.textContent = 'Welcome Back';
        submitBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
        toggle.textContent = "Don't have an account? Sign up";
        fullNameGroup.style.display = 'none';
        subjectGroup.style.display = 'none';
        schoolGroup.style.display = 'none';
        document.getElementById('fullName').required = false;
    }
    
    // Clear form
    document.getElementById('authForm').reset();
    clearAlert('authAlert');
}

async function verifyToken() {
    try {
        const response = await apiCall('/auth/verify');
        if (response.valid) {
            currentUser = response.user;
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

async function loadUserProfile() {
    try {
        const profile = await apiCall('/auth/profile');
        currentUser = { ...currentUser, ...profile.user };
        
        // Update UI
        const initials = currentUser.fullName.split(' ').map(n => n[0]).join('').toUpperCase();
        document.getElementById('userInitials').textContent = initials;
        
        // Update profile form
        if (document.getElementById('profileFullName')) {
            document.getElementById('profileFullName').value = currentUser.fullName || '';
            document.getElementById('profileEmail').value = currentUser.email || '';
            document.getElementById('profileSubject').value = currentUser.subject || '';
            document.getElementById('profileSchool').value = currentUser.school || '';
        }
    } catch (error) {
        console.error('Failed to load profile:', error);
    }
}

function logout() {
    localStorage.removeItem('token');
    currentUser = null;
    showAuthPage();
    showAlert('authAlert', 'info', 'You have been logged out.');
}

// Navigation functions
function showAuthPage() {
    document.getElementById('authPage').classList.remove('hidden');
    document.getElementById('navbar').classList.add('hidden');
    hideAllPages();
}

function showMainApp() {
    document.getElementById('authPage').classList.add('hidden');
    document.getElementById('navbar').classList.remove('hidden');
}

function navigateToPage(page) {
    currentPage = page;
    hideAllPages();
    
    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-page') === page) {
            link.classList.add('active');
        }
    });
    
    // Show selected page
    switch (page) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'files':
            loadFiles();
            break;
        case 'upload':
            loadUploadPage();
            break;
        case 'profile':
            loadProfilePage();
            break;
    }
}

function hideAllPages() {
    document.querySelectorAll('#dashboardPage, #filesPage, #uploadPage, #profilePage').forEach(page => {
        page.classList.add('hidden');
    });
}

// Dashboard functions
async function loadDashboard() {
    document.getElementById('dashboardPage').classList.remove('hidden');
    
    try {
        // Load statistics
        const stats = await apiCall('/files/stats/storage');
        renderStatistics(stats);
        
        // Load recent files
        const files = await apiCall('/files?limit=6');
        renderRecentFiles(files.files);
    } catch (error) {
        console.error('Dashboard load error:', error);
    }
}

function renderStatistics(stats) {
    const statsGrid = document.getElementById('statsGrid');
    statsGrid.innerHTML = `
        <div class="stat-card">
            <i class="fas fa-file stat-icon"></i>
            <div class="stat-number">${stats.totalFiles}</div>
            <div class="stat-label">Total Files</div>
        </div>
        <div class="stat-card">
            <i class="fas fa-hdd stat-icon"></i>
            <div class="stat-number">${formatFileSize(stats.totalSize)}</div>
            <div class="stat-label">Storage Used</div>
        </div>
        <div class="stat-card">
            <i class="fas fa-file-alt stat-icon"></i>
            <div class="stat-number">${stats.categories.documents}</div>
            <div class="stat-label">Documents</div>
        </div>
        <div class="stat-card">
            <i class="fas fa-image stat-icon"></i>
            <div class="stat-number">${stats.categories.images}</div>
            <div class="stat-label">Images</div>
        </div>
    `;
}

function renderRecentFiles(files) {
    const recentFiles = document.getElementById('recentFiles');
    if (files.length === 0) {
        recentFiles.innerHTML = '<div class="text-center">No files uploaded yet.</div>';
        return;
    }
    
    recentFiles.innerHTML = files.map(file => createFileCard(file)).join('');
}

// File management functions
async function loadFiles() {
    document.getElementById('filesPage').classList.remove('hidden');
    await fetchAndRenderFiles();
}

async function fetchAndRenderFiles(page = 1, append = false) {
    try {
        const search = document.getElementById('searchFiles').value;
        const category = document.getElementById('categoryFilter').value;
        const sortBy = document.getElementById('sortBy').value;
        
        const params = new URLSearchParams({
            page: page.toString(),
            limit: '20'
        });
        
        if (search) params.append('search', search);
        if (category) params.append('category', category);
        if (sortBy) params.append('sortBy', sortBy);
        
        const response = await apiCall(`/files?${params}`);
        
        if (append) {
            currentFiles = [...currentFiles, ...response.files];
        } else {
            currentFiles = response.files;
        }
        
        renderFiles(currentFiles, append);
        
        // Show/hide load more button
        const loadMoreBtn = document.getElementById('loadMoreFiles');
        if (response.pagination.page < response.pagination.pages) {
            loadMoreBtn.style.display = 'block';
            loadMoreBtn.onclick = () => fetchAndRenderFiles(page + 1, true);
        } else {
            loadMoreBtn.style.display = 'none';
        }
    } catch (error) {
        console.error('Files load error:', error);
    }
}

function renderFiles(files, append = false) {
    const filesGrid = document.getElementById('filesGrid');
    
    if (files.length === 0 && !append) {
        filesGrid.innerHTML = '<div class="text-center">No files found.</div>';
        return;
    }
    
    const html = files.map(file => createFileCard(file)).join('');
    
    if (append) {
        filesGrid.innerHTML += html;
    } else {
        filesGrid.innerHTML = html;
    }
}

function createFileCard(file) {
    const icon = getFileIcon(file.category, file.originalName);
    const date = new Date(file.createdAt).toLocaleDateString();
    
    return `
        <div class="file-card">
            <div class="file-preview">
                <i class="${icon} file-icon"></i>
            </div>
            <div class="file-info">
                <div class="file-name">${file.originalName}</div>
                <div class="file-meta">
                    <span>${formatFileSize(file.size)}</span>
                    <span>${date}</span>
                </div>
                <div class="file-actions-buttons">
                    <button class="btn btn-sm btn-secondary" onclick="previewFile(${file.id})">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-primary" onclick="downloadFile(${file.id})">
                        <i class="fas fa-download"></i>
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="editFile(${file.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteFile(${file.id}, '${file.originalName}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// File operations
async function previewFile(fileId) {
    try {
        showLoading(true);
        const response = await fetch(`${API_BASE}/files/${fileId}/preview`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        if (response.ok) {
            const contentType = response.headers.get('Content-Type');
            
            if (contentType && contentType.startsWith('image/')) {
                // Show image preview
                const blob = await response.blob();
                const imageUrl = URL.createObjectURL(blob);
                document.getElementById('previewContent').innerHTML = 
                    `<img src="${imageUrl}" style="max-width: 100%; height: auto;" alt="Preview">`;
            } else {
                // Show text/document preview
                const data = await response.json();
                if (data.content) {
                    document.getElementById('previewContent').innerHTML = 
                        `<pre style="white-space: pre-wrap; max-height: 400px; overflow-y: auto;">${data.content}</pre>`;
                } else {
                    document.getElementById('previewContent').innerHTML = 
                        '<div class="text-center">Preview not available for this file type.</div>';
                }
            }
            
            currentFileId = fileId;
            document.getElementById('downloadFromPreview').onclick = () => downloadFile(fileId);
            showModal('previewModal');
        } else {
            showAlert('', 'error', 'Failed to load preview');
        }
    } catch (error) {
        console.error('Preview error:', error);
        showAlert('', 'error', 'Failed to load preview');
    } finally {
        showLoading(false);
    }
}

async function downloadFile(fileId) {
    try {
        const response = await fetch(`${API_BASE}/files/${fileId}/download`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            
            // Get filename from Content-Disposition header
            const contentDisposition = response.headers.get('Content-Disposition');
            const filename = contentDisposition ? 
                contentDisposition.split('filename=')[1].replace(/"/g, '') : 
                'download';
            
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } else {
            showAlert('', 'error', 'Failed to download file');
        }
    } catch (error) {
        console.error('Download error:', error);
        showAlert('', 'error', 'Failed to download file');
    }
}

async function editFile(fileId) {
    try {
        const file = await apiCall(`/files/${fileId}`);
        
        document.getElementById('editDescription').value = file.description || '';
        document.getElementById('editCategory').value = file.category;
        document.getElementById('editIsPublic').checked = file.isPublic;
        
        currentFileId = fileId;
        showModal('editModal');
    } catch (error) {
        console.error('Edit file error:', error);
        showAlert('', 'error', 'Failed to load file details');
    }
}

async function saveFileEdit() {
    try {
        showLoading(true);
        
        const data = {
            description: document.getElementById('editDescription').value,
            category: document.getElementById('editCategory').value,
            isPublic: document.getElementById('editIsPublic').checked
        };
        
        await apiCall(`/files/${currentFileId}`, 'PUT', data);
        
        showAlert('', 'success', 'File updated successfully');
        closeModal('editModal');
        
        // Refresh current page
        if (currentPage === 'files') {
            fetchAndRenderFiles();
        } else if (currentPage === 'dashboard') {
            loadDashboard();
        }
    } catch (error) {
        console.error('Save edit error:', error);
        showAlert('', 'error', 'Failed to update file');
    } finally {
        showLoading(false);
    }
}

async function deleteFile(fileId, filename) {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
        return;
    }
    
    try {
        showLoading(true);
        await apiCall(`/files/${fileId}`, 'DELETE');
        
        showAlert('', 'success', 'File deleted successfully');
        
        // Refresh current page
        if (currentPage === 'files') {
            fetchAndRenderFiles();
        } else if (currentPage === 'dashboard') {
            loadDashboard();
        }
    } catch (error) {
        console.error('Delete error:', error);
        showAlert('', 'error', 'Failed to delete file');
    } finally {
        showLoading(false);
    }
}

// File upload functions
function loadUploadPage() {
    document.getElementById('uploadPage').classList.remove('hidden');
    document.getElementById('uploadedFiles').innerHTML = '';
    document.getElementById('uploadProgress').classList.add('hidden');
}

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
}

function handleFileDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    const files = e.dataTransfer.files;
    uploadFiles(files);
}

function handleFileSelect(e) {
    const files = e.target.files;
    uploadFiles(files);
}

async function uploadFiles(files) {
    if (files.length === 0) return;
    
    const formData = new FormData();
    for (let file of files) {
        formData.append('files', file);
    }
    
    try {
        showLoading(true);
        document.getElementById('uploadProgress').classList.remove('hidden');
        
        const response = await fetch(`${API_BASE}/files/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('', 'success', `Successfully uploaded ${data.files.length} file(s)`);
            renderUploadedFiles(data.files);
        } else {
            showAlert('', 'error', data.message || 'Upload failed');
        }
    } catch (error) {
        console.error('Upload error:', error);
        showAlert('', 'error', 'Upload failed');
    } finally {
        showLoading(false);
        document.getElementById('uploadProgress').classList.add('hidden');
        document.getElementById('fileInput').value = '';
    }
}

function renderUploadedFiles(files) {
    const container = document.getElementById('uploadedFiles');
    const html = files.map(file => `
        <div class="alert alert-success">
            <i class="fas fa-check-circle"></i>
            <strong>${file.originalName}</strong> uploaded successfully (${formatFileSize(file.size)})
        </div>
    `).join('');
    container.innerHTML = html;
}

// Profile functions
function loadProfilePage() {
    document.getElementById('profilePage').classList.remove('hidden');
}

async function updateProfile(e) {
    e.preventDefault();
    
    try {
        showLoading(true);
        
        const data = {
            fullName: document.getElementById('profileFullName').value,
            subject: document.getElementById('profileSubject').value,
            school: document.getElementById('profileSchool').value
        };
        
        const response = await apiCall('/auth/profile', 'PUT', data);
        
        showAlert('profileAlert', 'success', 'Profile updated successfully');
        currentUser = { ...currentUser, ...response.user };
        
        // Update user initials
        const initials = currentUser.fullName.split(' ').map(n => n[0]).join('').toUpperCase();
        document.getElementById('userInitials').textContent = initials;
    } catch (error) {
        console.error('Profile update error:', error);
        showAlert('profileAlert', 'error', 'Failed to update profile');
    } finally {
        showLoading(false);
    }
}

// Search and filter functions
function searchFiles() {
    fetchAndRenderFiles();
}

function filterFiles() {
    fetchAndRenderFiles();
}

function sortFiles() {
    fetchAndRenderFiles();
}

// Utility functions
async function apiCall(endpoint, method = 'GET', data = null) {
    const config = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    };
    
    if (data) {
        config.body = JSON.stringify(data);
    }
    
    const response = await fetch(`${API_BASE}${endpoint}`, config);
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || 'Request failed');
    }
    
    return await response.json();
}

function showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
}

function showAlert(containerId, type, message) {
    const container = containerId ? document.getElementById(containerId) : document.body;
    const alertClass = `alert-${type}`;
    const icon = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info-circle'
    }[type];
    
    const alertHtml = `
        <div class="alert ${alertClass}">
            <i class="${icon}"></i>
            ${message}
        </div>
    `;
    
    if (containerId) {
        container.innerHTML = alertHtml;
    } else {
        // Show temporary alert
        const alertDiv = document.createElement('div');
        alertDiv.innerHTML = alertHtml;
        alertDiv.style.position = 'fixed';
        alertDiv.style.top = '20px';
        alertDiv.style.right = '20px';
        alertDiv.style.zIndex = '10000';
        document.body.appendChild(alertDiv);
        
        setTimeout(() => {
            document.body.removeChild(alertDiv);
        }, 5000);
    }
}

function clearAlert(containerId) {
    document.getElementById(containerId).innerHTML = '';
}

function showModal(modalId) {
    document.getElementById(modalId).classList.add('show');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

function toggleUserMenu() {
    document.getElementById('userDropdown').classList.toggle('show');
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(category, filename) {
    const ext = filename.split('.').pop().toLowerCase();
    
    switch (category) {
        case 'document':
            if (ext === 'pdf') return 'fas fa-file-pdf';
            if (['doc', 'docx'].includes(ext)) return 'fas fa-file-word';
            if (ext === 'txt') return 'fas fa-file-alt';
            return 'fas fa-file-alt';
        case 'image':
            return 'fas fa-file-image';
        case 'presentation':
            return 'fas fa-file-powerpoint';
        case 'spreadsheet':
            return 'fas fa-file-excel';
        default:
            return 'fas fa-file';
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}