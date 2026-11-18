// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title CertificateRegistry
/// @notice Menyimpan hash SHA-256 sertifikat PDF beserta issuer dan statusnya.
///         Data mahasiswa (nama, NIM, nilai) disimpan off-chain.
contract CertificateRegistry is Ownable2Step {
    enum Role {
        VERIFIER,
        ISSUER,
        ADMIN
    }

    struct Certificate {
        address issuer;
        bytes32 recipient; // HMAC dari NIM, bukan NIM asli
        uint64 issuedAt;
        uint64 updatedAt;
        uint64 revokedAt;
        bool revoked;
    }

    mapping(bytes32 => Certificate) private _certificates;
    mapping(address => bytes32[]) private _certificatesByIssuer;

    mapping(address => bool) private _activeIssuers;
    mapping(address => bool) private _everRegistered;
    address[] private _issuerList;

    uint256 public totalCertificates;

    event IssuerAdded(address indexed issuer, address indexed admin);
    event IssuerRemoved(address indexed issuer, address indexed admin);
    event CertificateIssued(bytes32 indexed certHash, address indexed issuer, bytes32 recipient, uint64 issuedAt);
    event MetadataUpdated(bytes32 indexed certHash, address indexed issuer, bytes32 oldRecipient, bytes32 newRecipient);
    event CertificateRevoked(bytes32 indexed certHash, address indexed revokedBy, uint64 revokedAt);

    error ZeroAddress();
    error ZeroHash();
    error ZeroRecipient();
    error AdminCannotBeIssuer();
    error IssuerAlreadyActive(address account);
    error IssuerNotActive(address account);
    error NotActiveIssuer(address caller);
    error CertificateAlreadyExists(bytes32 certHash);
    error CertificateNotFound(bytes32 certHash);
    error NotCertificateIssuer(address caller, bytes32 certHash);
    error CertificateAlreadyRevoked(bytes32 certHash);
    error SameRecipient();
    error RenounceDisabled();

    modifier onlyActiveIssuer() {
        if (!_activeIssuers[msg.sender]) revert NotActiveIssuer(msg.sender);
        _;
    }

    constructor(address initialAdmin) Ownable(initialAdmin) {}

    function addIssuer(address account) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (account == owner()) revert AdminCannotBeIssuer();
        if (_activeIssuers[account]) revert IssuerAlreadyActive(account);

        if (!_everRegistered[account]) {
            _everRegistered[account] = true;
            _issuerList.push(account);
        }
        _activeIssuers[account] = true;
        emit IssuerAdded(account, msg.sender);
    }

    /// @notice Sertifikat yang sudah diterbitkan issuer ini tetap valid.
    function removeIssuer(address account) external onlyOwner {
        if (!_activeIssuers[account]) revert IssuerNotActive(account);
        _activeIssuers[account] = false;
        emit IssuerRemoved(account, msg.sender);
    }

    function issue(bytes32 certHash, bytes32 recipient) external onlyActiveIssuer {
        if (certHash == bytes32(0)) revert ZeroHash();
        if (recipient == bytes32(0)) revert ZeroRecipient();
        if (_certificates[certHash].issuer != address(0)) revert CertificateAlreadyExists(certHash);

        uint64 nowTs = uint64(block.timestamp);
        _certificates[certHash] = Certificate({
            issuer: msg.sender,
            recipient: recipient,
            issuedAt: nowTs,
            updatedAt: nowTs,
            revokedAt: 0,
            revoked: false
        });
        _certificatesByIssuer[msg.sender].push(certHash);
        totalCertificates += 1;

        emit CertificateIssued(certHash, msg.sender, recipient, nowTs);
    }

    /// @notice Mengganti kode penerima, misalnya jika NIM salah input.
    function updateMetadata(bytes32 certHash, bytes32 newRecipient) external onlyActiveIssuer {
        Certificate storage cert = _getExisting(certHash);
        if (cert.issuer != msg.sender) revert NotCertificateIssuer(msg.sender, certHash);
        if (cert.revoked) revert CertificateAlreadyRevoked(certHash);
        if (newRecipient == bytes32(0)) revert ZeroRecipient();
        if (newRecipient == cert.recipient) revert SameRecipient();

        bytes32 oldRecipient = cert.recipient;
        cert.recipient = newRecipient;
        cert.updatedAt = uint64(block.timestamp);

        emit MetadataUpdated(certHash, msg.sender, oldRecipient, newRecipient);
    }

    /// @notice Bisa dipanggil issuer pembuat sertifikat atau admin.
    ///         Data sertifikat tidak dihapus, hanya ditandai revoked.
    function revoke(bytes32 certHash) external {
        Certificate storage cert = _getExisting(certHash);
        if (cert.revoked) revert CertificateAlreadyRevoked(certHash);

        bool isAdmin = msg.sender == owner();
        if (!isAdmin) {
            if (!_activeIssuers[msg.sender]) revert NotActiveIssuer(msg.sender);
            if (cert.issuer != msg.sender) revert NotCertificateIssuer(msg.sender, certHash);
        }

        cert.revoked = true;
        cert.revokedAt = uint64(block.timestamp);
        emit CertificateRevoked(certHash, msg.sender, cert.revokedAt);
    }

    function verify(bytes32 certHash)
        external
        view
        returns (
            bool exists,
            address issuer,
            bytes32 recipient,
            uint64 issuedAt,
            uint64 updatedAt,
            bool revoked,
            uint64 revokedAt,
            bool issuerActive
        )
    {
        Certificate storage cert = _certificates[certHash];
        exists = cert.issuer != address(0);
        return (
            exists,
            cert.issuer,
            cert.recipient,
            cert.issuedAt,
            cert.updatedAt,
            cert.revoked,
            cert.revokedAt,
            exists && _activeIssuers[cert.issuer]
        );
    }

    function getRole(address account) external view returns (Role) {
        if (account == owner()) return Role.ADMIN;
        if (_activeIssuers[account]) return Role.ISSUER;
        return Role.VERIFIER;
    }

    function isActiveIssuer(address account) external view returns (bool) {
        return _activeIssuers[account];
    }

    /// @notice Semua wallet yang pernah menjadi issuer, beserta status aktifnya.
    function getIssuers() external view returns (address[] memory accounts, bool[] memory active) {
        uint256 n = _issuerList.length;
        accounts = new address[](n);
        active = new bool[](n);
        for (uint256 i = 0; i < n; i++) {
            accounts[i] = _issuerList[i];
            active[i] = _activeIssuers[_issuerList[i]];
        }
    }

    function getCertificatesByIssuer(address issuer) external view returns (bytes32[] memory) {
        return _certificatesByIssuer[issuer];
    }

    /// @dev Dinonaktifkan supaya contract tidak kehilangan admin.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @dev Admin baru tidak boleh berstatus issuer aktif.
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (_activeIssuers[newOwner]) revert AdminCannotBeIssuer();
        super.transferOwnership(newOwner);
    }

    /// @dev Dicek ulang di sini karena calon admin bisa saja dijadikan issuer
    ///      setelah transferOwnership() dipanggil.
    function acceptOwnership() public override {
        if (_activeIssuers[msg.sender]) revert AdminCannotBeIssuer();
        super.acceptOwnership();
    }

    function _getExisting(bytes32 certHash) private view returns (Certificate storage cert) {
        cert = _certificates[certHash];
        if (cert.issuer == address(0)) revert CertificateNotFound(certHash);
    }
}
